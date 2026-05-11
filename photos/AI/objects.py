import time
from photos.models import *

NAME_TO_ID_MAPPING = {
    "person": 0, "sneakers": 1, "chair": 2, "other_shoes": 3, "hat": 4, "car": 5,
    "lamp": 6, "glasses": 7, "bottle": 8, "desk": 9, "cup": 10, "street_lights": 11,
    "cabinet": 12, "shelf": 12, "handbag": 13, "satchel": 13, "bracelet": 14,
    "plate": 15, "picture": 16, "frame": 16, "helmet": 17, "book": 18, "gloves": 19,
    "storage_box": 20, "boat": 21, "leather_shoes": 22, "flower": 23, "bench": 24,
    "potted_plant": 25, "bowl": 26, "basin": 26, "flag": 27, "pillow": 28, "boots": 29,
    "vase": 30, "microphone": 31, "necklace": 32, "ring": 33, "suv": 34, "wine_glass": 35,
    "belt": 36, "monitor": 37, "tv": 37, "backpack": 38, "umbrella": 39,
    "traffic_light": 40, "speaker": 41, "watch": 42, "tie": 43, "trash_bin_can": 44,
    "slippers": 45, "bicycle": 46, "stool": 47, "barrel": 48, "bucket": 48, "van": 49,
    "couch": 50, "sandals": 51, "basket": 52, "drum": 53, "pen": 54, "pencil": 54,
    "bus": 55, "wild_bird": 56, "high_heels": 57, "motorcycle": 58, "guitar": 59,
    "carpet": 60, "cell_phone": 61, "bread": 62, "camera": 63, "canned": 64,
    "truck": 65, "traffic_cone": 66, "cymbal": 67, "lifesaver": 68, "towel": 69,
    "stuffed_toy": 70, "candle": 71, "sailboat": 72, "laptop": 73, "awning": 74,
    "bed": 75, "faucet": 76, "tent": 77, "horse": 78, "mirror": 79, "power_outlet": 80,
    "sink": 81, "apple": 82, "air_conditioner": 83, "knife": 84, "hockey_stick": 85,
    "paddle": 86, "pickup_truck": 87, "fork": 88, "traffic_sign": 89, "balloon": 90,
    "tripod": 91, "dog": 92, "spoon": 93, "clock": 94, "pot": 95, "cow": 96, "cake": 97,
    "dining_table": 98, "sheep": 99, "hanger": 100, "blackboard": 101, "whiteboard": 101,
    "napkin": 102, "other_fish": 103, "orange": 104, "tangerine": 104, "toiletry": 105,
    "keyboard": 106, "tomato": 107, "lantern": 108, "machinery_vehicle": 109, "fan": 110,
    "green_vegetables": 111, "banana": 112, "baseball_glove": 113, "airplane": 114,
    "mouse": 115, "train": 116, "pumpkin": 117, "soccer": 118, "skiboard": 119,
    "luggage": 120, "nightstand": 121, "tea_pot": 122, "telephone": 123, "trolley": 124,
    "head_phone": 125, "sports_car": 126, "stop_sign": 127, "dessert": 128, "scooter": 129,
    "stroller": 130, "crane": 131, "remote": 132, "refrigerator": 133, "oven": 134,
    "lemon": 135, "duck": 136, "baseball_bat": 137, "surveillance_camera": 138,
    "cat": 139, "jug": 140, "broccoli": 141, "piano": 142, "pizza": 143, "elephant": 144,
    "skateboard": 145, "surfboard": 146, "gun": 147, "skating_and_skiing_shoes": 148,
    "gas_stove": 149, "donut": 150, "bow_tie": 151, "carrot": 152, "toilet": 153,
    "kite": 154, "strawberry": 155, "other_balls": 156, "shovel": 157, "pepper": 158,
    "computer_box": 159, "toilet_paper": 160, "cleaning_products": 161, "chopsticks": 162,
    "microwave": 163, "pigeon": 164, "baseball": 165, "cutting": 166, "chopping_board": 166,
    "coffee_table": 167, "side_table": 168, "scissors": 169, "marker": 170, "pie": 171,
    "ladder": 172, "snowboard": 173, "cookies": 174, "radiator": 175, "fire_hydrant": 176,
    "basketball": 177, "zebra": 178, "grape": 179, "giraffe": 180, "potato": 181,
    "sausage": 182, "tricycle": 183, "violin": 184, "egg": 185, "fire_extinguisher": 186,
    "candy": 187, "fire_truck": 188, "billiards": 189, "converter": 190, "bathtub": 191,
    "wheelchair": 192, "golf_club": 193, "briefcase": 194, "cucumber": 195,
    "cigar": 196, "cigarette": 196, "paint_brush": 197, "pear": 198, "heavy_truck": 199,
    "hamburger": 200, "extractor": 201, "extension_cord": 202, "tong": 203,
    "tennis_racket": 204, "folder": 205, "american_football": 206, "earphone": 207,
    "mask": 208, "kettle": 209, "tennis": 210, "ship": 211, "swing": 212,
    "coffee_machine": 213, "slide": 214, "carriage": 215, "onion": 216,
    "green_beans": 217, "projector": 218, "frisbee": 219, "washing_machine": 220,
    "drying_machine": 220, "chicken": 221, "printer": 222, "watermelon": 223,
    "saxophone": 224, "tissue": 225, "toothbrush": 226, "ice_cream": 227,
    "hot-air_balloon": 228, "cello": 229, "french_fries": 230, "scale": 231,
    "trophy": 232, "cabbage": 233, "hot_dog": 234, "blender": 235, "peach": 236,
    "rice": 237, "wallet": 238, "purse": 238, "volleyball": 239, "deer": 240,
    "goose": 241, "tape": 242, "tablet": 243, "cosmetics": 244, "trumpet": 245,
    "pineapple": 246, "golf_ball": 247, "ambulance": 248, "parking_meter": 249,
    "mango": 250, "key": 251, "hurdle": 252, "fishing_rod": 253, "medal": 254,
    "flute": 255, "brush": 256, "penguin": 257, "megaphone": 258, "corn": 259,
    "lettuce": 260, "garlic": 261, "swan": 262, "helicopter": 263, "green_onion": 264,
    "sandwich": 265, "nuts": 266, "speed_limit_sign": 267, "induction_cooker": 268,
    "broom": 269, "trombone": 270, "plum": 271, "rickshaw": 272, "goldfish": 273,
    "kiwi_fruit": 274, "router": 275, "modem": 275, "poker_card": 276, "toaster": 277,
    "shrimp": 278, "sushi": 279, "cheese": 280, "notepaper": 281, "cherry": 282,
    "pliers": 283, "cd": 284, "pasta": 285, "hammer": 286, "cue": 287, "avocado": 288,
    "hami_melon": 289, "flask": 290, "mushroom": 291, "screwdriver": 292, "soap": 293,
    "recorder": 294, "bear": 295, "eggplant": 296, "board_eraser": 297, "coconut": 298,
    "tape_measure": 299, "ruler": 299, "pig": 300, "showerhead": 301, "globe": 302,
    "chips": 303, "steak": 304, "crosswalk_sign": 305, "stapler": 306, "camel": 307,
    "formula_1": 308, "pomegranate": 309, "dishwasher": 310, "crab": 311,
    "hoverboard": 312, "meatball": 313, "rice_cooker": 314, "tuba": 315,
    "calculator": 316, "papaya": 317, "antelope": 318, "parrot": 319, "seal": 320,
    "butterfly": 321, "dumbbell": 322, "donkey": 323, "lion": 324, "urinal": 325,
    "dolphin": 326, "electric_drill": 327, "hair_dryer": 328, "egg_tart": 329,
    "jellyfish": 330, "treadmill": 331, "lighter": 332, "grapefruit": 333,
    "game_board": 334, "mop": 335, "radish": 336, "baozi": 337, "target": 338,
    "french": 339, "spring_rolls": 340, "monkey": 341, "rabbit": 342,
    "pencil_case": 343, "yak": 344, "red_cabbage": 345, "binoculars": 346,
    "asparagus": 347, "barbell": 348, "scallop": 349, "noddles": 350, "comb": 351,
    "dumpling": 352, "oyster": 353, "table_tennis_paddle": 354, "cosmetics_brush": 355,
    "eyeliner_pencil": 355, "chainsaw": 356, "eraser": 357, "lobster": 358,
    "durian": 359, "okra": 360, "lipstick": 361, "cosmetics_mirror": 362,
    "curling": 363, "table_tennis": 364
}

CONFIDENCE_THRESHOLD = 0.5


def _frame_interval_seconds(duration_seconds):
    """Returns the sampling interval in seconds based on video duration."""
    if duration_seconds < 15:
        return 1
    elif duration_seconds < 300:   # up to 5 minutes
        return 5
    elif duration_seconds < 1800:  # up to 30 minutes
        return 15
    else:
        return 60


def _extract_video_frames(filepath, duration_seconds):
    """Extract evenly-spaced frames from a video. Returns list of PIL Images (RGB)."""
    import cv2
    from PIL import Image

    cap = cv2.VideoCapture(filepath)
    if not cap.isOpened():
        return []

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if fps <= 0 or total_frames <= 0:
        cap.release()
        return []

    interval_sec = _frame_interval_seconds(duration_seconds)
    frame_step = max(1, int(fps * interval_sec))

    frames = []
    pos = 0
    while pos < total_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, pos)
        ret, frame = cap.read()
        if not ret:
            break
        # Wrap as a PIL Image (RGB) — identical to how YOLO loads image files internally
        frames.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
        pos += frame_step

    cap.release()
    return frames


def _collect_objects_from_results(results):
    object_numbers = set()
    for result in results:
        for box in result.boxes:
            if box.conf.item() >= CONFIDENCE_THRESHOLD:
                object_numbers.add(int(box.cls))
    return object_numbers


def run(images, force_reindex=False, delay=0):
    if type(images) is Photo:
        images = [images]

    from ultralytics import YOLO

    model = YOLO("yolo11n_object365.pt")

    for img in images:

        already_indexed = (
            hasattr(img, "ai_index_info") and
            img.ai_index_info is not None and
            img.ai_index_info.get("objects")  # non-empty list only
        )
        if already_indexed and not force_reindex:
            print(f"Photo {img.id} already indexed, skipping.")
            continue

        try:
            if img.video:
                duration = img.length
                if duration is None:
                    print(f"Photo {img.id} is a video with unknown duration, skipping.")
                    continue

                frames = _extract_video_frames(img.get_filepath(), duration)
                if not frames:
                    print(f"Photo {img.id} could not extract frames, skipping.")
                    continue

                object_numbers = set()
                for frame in frames:
                    results = model(frame)
                    object_numbers |= _collect_objects_from_results(results)

                print(f"Photo {img.id} (video, {duration}s, {len(frames)} frames) indexed with objects: {sorted(object_numbers)}")

            else:
                results = model(img.get_filepath())
                object_numbers = _collect_objects_from_results(results)
                print(f"Photo {img.id} indexed with objects: {sorted(object_numbers)}")

            if not hasattr(img, "ai_index_info") or img.ai_index_info is None:
                img.ai_index_info = {}

            img.ai_index_info = {**img.ai_index_info, "objects": list(object_numbers)}
            img.save(update_fields=["ai_index_info"])

            if delay > 0:
                time.sleep(delay)

        except Exception as e:
            print(f"Photo {img.id} failed to index: {e}")
            continue
