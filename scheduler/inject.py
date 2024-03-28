def get_additions(month, year, uid):
    cals = {
        "calendar": {
            "active": True,
            "auto_sync": True,
            "calendar_type": -1,
            "colour": "#000000",
            "id": -1,
            "name": "TEST",
        },
        "colour": "#000000",
        "display_busy": 0,
        "id": -1,
        "subscribe_type": 0,
        "user": uid,
    }

    evs = [
        {
            "allday": False,
            "calendar": -1,
            "category": 0,
            "completed": False,
            "description": "Testing event",
            "enddate": f"{year}-{f'0{month}' if int(month) < 10 else month}-{f'0{i}' if i < 10 else i}T16:50:00Z",
            "id": "!NO_ID!",
            "location": None,
            "name": f"Testing[{i}]!!!",
            "priority": 10,
            "public": False,
            "startdate": f"{year}-{f'0{month}' if int(month) < 10 else month}-{f'0{i}' if i < 10 else i}T15:30:00Z",
        } for i in range(1, 5)
    ]

    return cals, evs
