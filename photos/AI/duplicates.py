import hashlib
import time


def md5_hash(path: str) -> str:
    """Compute MD5 of a file in streaming chunks. Returns a 32-char hex string."""
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def run(photos, force_reindex=False, delay=0):
    """Compute md5_hash for a queryset or list of Photo instances.

    Skips already-indexed photos unless force_reindex=True.
    """
    if hasattr(photos, "model"):   # queryset → list
        photos = list(photos)

    for photo in photos:
        if not force_reindex and photo.md5_hash:
            continue

        try:
            fp = photo.get_filepath()
            photo.md5_hash = md5_hash(fp)
            photo.save(update_fields=["md5_hash"])
            print(f"Photo {photo.id} hashed (md5={photo.md5_hash[:8]}…)")
        except Exception as e:
            print(f"Photo {photo.id} duplicate-hash failed: {e}")

        if delay:
            time.sleep(delay)

