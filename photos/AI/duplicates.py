import hashlib
import time

from PIL import Image, ImageOps
import imagehash

PHASH_SIZE = 16   # 256-bit pHash (more accurate than default 64-bit)


def md5_hash(path: str) -> str:
    """Compute MD5 of a file in streaming chunks. Returns a 32-char hex string."""
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def perceptual_hash(path: str) -> str:
    """Compute pHash of an image. Returns a 64-char hex string (256-bit).

    Two images with Hamming distance ≤ 8 are near-duplicates.
    Distance = 0 means visually identical despite different bytes.
    """
    img = Image.open(path)
    img = ImageOps.exif_transpose(img).convert("RGB")
    return str(imagehash.phash(img, hash_size=PHASH_SIZE))


def hamming_distance(hash_a: str, hash_b: str) -> int:
    """Return the Hamming distance between two pHash strings (lower = more similar)."""
    return imagehash.hex_to_hash(hash_a) - imagehash.hex_to_hash(hash_b)


def run(photos, force_reindex=False, delay=0):
    """Compute md5_hash + phash for a queryset or list of Photo instances.

    Skips already-indexed photos unless force_reindex=True.
    Videos get md5_hash only (phash is image-specific).
    """
    if hasattr(photos, "model"):   # queryset → list
        photos = list(photos)

    for photo in photos:
        if not force_reindex and photo.md5_hash and photo.phash:
            continue

        try:
            fp = photo.get_filepath()
            photo.md5_hash = md5_hash(fp)
            if not photo.video:
                photo.phash = perceptual_hash(fp)
            photo.save(update_fields=["md5_hash", "phash"])
            print(f"Photo {photo.id} hashed (md5={photo.md5_hash[:8]}…)")
        except Exception as e:
            print(f"Photo {photo.id} duplicate-hash failed: {e}")

        if delay:
            time.sleep(delay)
