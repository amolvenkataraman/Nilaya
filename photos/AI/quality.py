import time

import cv2


def blur_score(path: str):
    """Compute Laplacian variance of a grayscale image.

    Higher = sharper. Empirically < 50 is noticeably blurry for 12 MP photos,
    but the threshold is resolution-dependent — calibrate on a sample.
    Returns None if the file cannot be read (e.g. unsupported format).
    """
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    return float(cv2.Laplacian(img, cv2.CV_64F).var())


def run(photos, force_reindex=False, delay=0):
    """Compute blur_score for each photo and store it in ai_index_info["blur_score"].

    Skips already-scored photos unless force_reindex=True.
    Videos are skipped (blur scoring a single frame isn't representative).
    """
    if hasattr(photos, "model"):   # queryset → list
        photos = list(photos)

    for photo in photos:
        already_done = (
            photo.ai_index_info is not None and
            "blur_score" in photo.ai_index_info
        )
        if already_done and not force_reindex:
            continue

        if photo.video:
            # Skip videos — blur on a single frame isn't meaningful
            continue

        try:
            score = blur_score(photo.get_filepath())
            if photo.ai_index_info is None:
                photo.ai_index_info = {}
            photo.ai_index_info = {**photo.ai_index_info, "blur_score": score}
            photo.save(update_fields=["ai_index_info"])
            print(f"Photo {photo.id} blur_score={score:.1f}" if score is not None else f"Photo {photo.id} blur_score=None")
        except Exception as e:
            print(f"Photo {photo.id} quality scoring failed: {e}")

        if delay:
            time.sleep(delay)
