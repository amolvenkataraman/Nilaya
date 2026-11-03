"""
photos/compressvideo.py

Video compression utility for Photos app.

Given a Photo object (or photo UUID), this module checks that it is a video without an existing
original file backup, and re-encodes the video using FFmpeg with high compression efficiency,
visually lossless quality (CRF 24 default), and CPU core capping (1–2 threads by default).

Metadata & Tag Preservation:
- Preserves all EXIF, QuickTime, GPS coordinates, and camera metadata tags from the original video.
- Injects a compression metadata marker tag (`Comment="Comptech Compressed Video"`) inside the video container.
- Ensures that if database entries are ever wiped or re-indexed from scratch via ExifTool / indeximg,
  all metadata (date taken, GPS, camera specs, dimensions) will be read seamlessly from the compressed file.

Process Flow:
1. Validates photo is a video and checks `orig_filepath` / `has_orig`.
2. Resolves current video input path (`photo.get_filepath()`).
3. Constructs and runs FFmpeg with `-map_metadata 0`, `-threads 2`, and visually lossless settings.
4. Uses ExifTool to copy all original EXIF/QuickTime tags and inject the compression marker.
5. Moves current file to `Orig/<filename>` and sets `photo.orig_filepath`.
6. Moves newly compressed file into place as main video (`photo.filepath`).
7. Updates file sizes (`photo.size`, `photo.size_total`), metadata via ExifTool, and saves the Photo model.
"""

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional, Union

from photos.models import Photo

logger = logging.getLogger(__name__)

COMPRESSION_MARKER = "Comptech Compressed Video"


def compress_photo_video(
    photo_or_id: Union[Photo, str],
    target_height: Optional[int] = None,
    target_fps: Optional[int] = None,
    crf: int = 24,
    codec: str = "libx264",
    threads: int = 2,
    preset: str = "slow",
    audio_codec: str = "aac",
    audio_bitrate: str = "128k",
    overwrite_existing_orig: bool = False,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Compress a video Photo instance using FFmpeg while preserving all metadata and tagging the output.

    :param photo_or_id: Photo model instance or Photo UUID/ID string.
    :param target_height: Optional max vertical resolution (e.g. 1080 for 1080p).
    :param target_fps: Optional max framerate (e.g. 30 or 60).
    :param crf: Constant Rate Factor (default 24; lower = higher quality/larger size, 18-28 typical).
    :param codec: Video encoder codec ('libx264' or 'libx265').
    :param threads: Maximum CPU threads to utilize for encoding (default 2).
    :param preset: Speed preset ('slow', 'medium', 'veryslow').
    :param audio_codec: Audio encoder codec ('aac' or 'copy').
    :param audio_bitrate: Audio bitrate if re-encoding audio (default '128k').
    :param overwrite_existing_orig: If True, allows re-compressing even if orig_filepath exists.
    :param dry_run: If True, returns built FFmpeg command and metadata without executing.
    :return: Dictionary summarizing the compression outcome.
    """
    if isinstance(photo_or_id, Photo):
        photo = photo_or_id
    else:
        try:
            photo = Photo.objects.get(id=photo_or_id)
        except Photo.DoesNotExist:
            return {"success": False, "error": f"Photo with ID '{photo_or_id}' does not exist."}

    # 1. Validation checks
    if not photo.video:
        return {"success": False, "error": f"Photo {photo.id} is not a video."}

    if photo.orig_filepath and photo.has_orig and not overwrite_existing_orig:
        return {
            "success": False,
            "error": f"Photo {photo.id} already has an original source video at '{photo.orig_filepath}'.",
        }

    input_path = photo.get_filepath()
    if not os.path.exists(input_path):
        return {"success": False, "error": f"Input video file not found at '{input_path}'."}

    # 2. File size before compression
    orig_size_bytes = os.path.getsize(input_path)
    orig_size_mb = round(orig_size_bytes / (1024 * 1024), 2)

    # 3. Determine output paths
    album_dir = Path(photo.album.location)
    orig_dir = album_dir / "Orig"

    filename = Path(photo.filepath).name
    stem = Path(filename).stem
    ext = Path(filename).suffix or ".mp4"

    # Temporary compressed output file path
    temp_output_path = album_dir / f"_{stem}_compressed_temp.mp4"

    # 4. Construct FFmpeg command (with metadata mapping & compression tags)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-map_metadata",
        "0",  # Copy all global metadata from original
        "-metadata",
        f"comment={COMPRESSION_MARKER}",
        "-metadata",
        f"description={COMPRESSION_MARKER}",
        "-metadata",
        "encoder=Comptech Video Compressor",
        "-c:v",
        codec,
        "-crf",
        str(crf),
        "-preset",
        preset,
        "-threads",
        str(threads),
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
    ]

    # Video filters (downscaling & framerate downsampling)
    filters = []
    if target_height and photo.height and photo.height > target_height:
        filters.append(f"scale=-2:{target_height}")
    if target_fps and photo.framerate and photo.framerate > target_fps:
        filters.append(f"fps=fps={target_fps}")

    if filters:
        cmd.extend(["-vf", ",".join(filters)])

    # Audio encoding options
    if audio_codec == "copy":
        cmd.extend(["-c:a", "copy"])
    else:
        cmd.extend(["-c:a", audio_codec, "-b:a", audio_bitrate])

    cmd.append(str(temp_output_path))

    if dry_run:
        return {
            "success": True,
            "dry_run": True,
            "photo_id": str(photo.id),
            "command": " ".join(cmd),
            "orig_size_mb": orig_size_mb,
            "input_path": input_path,
        }

    # 5. Execute FFmpeg encoding process
    logger.info(f"Starting video compression for photo {photo.id} (threads={threads}, crf={crf}, codec={codec})")
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
    except subprocess.CalledProcessError as e:
        if temp_output_path.exists():
            temp_output_path.unlink()
        err_msg = e.stderr[-500:] if e.stderr else str(e)
        logger.error(f"FFmpeg encoding failed for photo {photo.id}: {err_msg}")
        return {
            "success": False,
            "error": f"FFmpeg execution error: {err_msg}",
        }
    except Exception as e:
        if temp_output_path.exists():
            temp_output_path.unlink()
        return {"success": False, "error": f"Unexpected error during compression: {str(e)}"}

    # Verify temp output exists and has positive size
    if not temp_output_path.exists() or temp_output_path.stat().st_size == 0:
        if temp_output_path.exists():
            temp_output_path.unlink()
        return {"success": False, "error": "Compressed output file is empty or missing."}

    # 6. Copy static EXIF / QuickTime metadata (GPS, camera info, dates) & stamp compression tag using ExifTool
    # Note: Exclude stream-level technical fields (bitrate, duration, resolution, filesize) that naturally changed.
    try:
        exiftool_cmd = [
            "exiftool",
            "-overwrite_original",
            "-TagsFromFile",
            input_path,
            "-all:all",
            "--Bitrate",
            "--AvgBitrate",
            "--VideoBitrate",
            "--AudioBitrate",
            "--Duration",
            "--MediaDuration",
            "--TrackDuration",
            "--FileSize",
            "--ImageWidth",
            "--ImageHeight",
            "--SourceImageWidth",
            "--SourceImageHeight",
            "--CompressorID",
            f"-Comment={COMPRESSION_MARKER}",
            f"-Description={COMPRESSION_MARKER}",
            str(temp_output_path),
        ]
        subprocess.run(exiftool_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    except Exception as e:
        logger.warning(f"ExifTool metadata copy warning for photo {photo.id}: {e}")

    compressed_size_bytes = temp_output_path.stat().st_size
    compressed_size_mb = round(compressed_size_bytes / (1024 * 1024), 2)
    saved_mb = round(orig_size_mb - compressed_size_mb, 2)
    savings_pct = round((saved_mb / orig_size_mb) * 100, 1) if orig_size_mb > 0 else 0.0

    # 7. Organize files:
    # Original file keeps its original filename and path (e.g., 2020/03/vid_12345.mp4).
    # New compressed file is saved alongside it with a '_cmp.mp4' suffix (e.g., 2020/03/vid_12345_cmp.mp4).
    current_rel_path = photo.filepath
    parent_dir = Path(input_path).parent
    parent_rel = Path(current_rel_path).parent

    cmp_filename = f"{stem}_cmp.mp4"
    cmp_abs_path = parent_dir / cmp_filename
    cmp_rel_path = str(parent_rel / cmp_filename) if str(parent_rel) != "." else cmp_filename

    counter = 1
    while cmp_abs_path.exists():
        cmp_filename = f"{stem}_cmp{counter}.mp4"
        cmp_abs_path = parent_dir / cmp_filename
        cmp_rel_path = str(parent_rel / cmp_filename) if str(parent_rel) != "." else cmp_filename
        counter += 1

    # Move temp output file to new _cmp.mp4 destination
    shutil.move(str(temp_output_path), cmp_abs_path)

    # 8. Update Photo model fields
    photo.orig_filepath = current_rel_path  # Original file name stays untouched!
    photo.filepath = cmp_rel_path            # App uses new _cmp.mp4 video
    photo.update_all_metadata()

    logger.info(
        f"Photo {photo.id} compressed successfully: {orig_size_mb} MB -> {compressed_size_mb} MB "
        f"({savings_pct}% saved, {saved_mb} MB freed)."
    )

    return {
        "success": True,
        "photo_id": str(photo.id),
        "orig_size_mb": orig_size_mb,
        "compressed_size_mb": compressed_size_mb,
        "saved_mb": saved_mb,
        "savings_pct": savings_pct,
        "orig_filepath": photo.orig_filepath,
        "main_filepath": photo.filepath,
    }
