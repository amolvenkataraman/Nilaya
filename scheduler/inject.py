import pytz
import sqlite3
import calendar
import datetime
import dateparser

COLOURS = ["#1abc9c", "#2ecc71", "#3498db", "#9b59b6", "#34495e", "#16a085", "#27ae60", "#2980b9", "#8e44ad", "#2c3e50", "#f1c40f", "#e67e22", "#e74c3c", "#ecf0f1", "#95a5a6", "#f39c12", "#d35400", "#c0392b", "#bdc3c7", "#7f8c8d"]

def tz_diff(date, tz1, tz2):
    '''
    Returns the difference in hours between timezone1 and timezone2
    for a given date.
    '''
    return (tz1.localize(date) - 
            tz2.localize(date).astimezone(tz1))\
            .seconds/3600

def inject_uw_courses(month, year, uid, subcode, catnum):
    from django.conf import settings
    sqliteConnection = sqlite3.connect(str(settings.BASE_DIR / 'UW_Courses.db'))
    cursor = sqliteConnection.cursor()

    if int(month) >= 9: tc1 = 9
    elif int(month) >= 5: tc1 = 5
    else: tc1 = 1
    tc = ((int(year) - 1900) * 10) + tc1

    colour = COLOURS[int(catnum) % 20] if catnum.isdigit() else COLOURS[ord(catnum[-1]) % len(COLOURS)]
    calcode = -1 * ((int(catnum) if catnum.isdigit() else ord(catnum[-1])) + ord(subcode[-1]))

    cals = [
        {
            "calendar": {
                "active": True,
                "auto_sync": True,
                "calendar_type": -1,
                "colour": colour,
                "id": calcode,
                "name": f"{subcode} {catnum}",
            },
            "colour": colour,
            "display_busy": 0,
            "id": calcode,
            "subscribe_type": 0,
            "user": uid,
        }
    ]

    evs = []

    res = cursor.execute(
        "SELECT classNumber, courseComponent, classSection, scheduleStartDate, scheduleEndDate, classMeetingStartTime, classMeetingEndTime, classMeetingWeekPatternCode, locationName, instructorName "
        "FROM classes WHERE termCode = ? AND courseId = (SELECT courseId FROM courses WHERE termCode = ? AND subjectCode = ? AND catalogNumber = ?) "
        "ORDER BY classMeetingStartTime;",
        (tc, tc, subcode, catnum),
    )
    clss = res.fetchall()

    for c in clss:
        cc = {
            "classNumber": c[0],
            "courseComponent": c[1],
            "classSection": c[2],
            "scheduleStartDate": dateparser.parse(c[3]).date(),
            "scheduleEndDate": dateparser.parse(c[4]).date(),
            "classMeetingStartTime": dateparser.parse(c[5]),
            "classMeetingEndTime": dateparser.parse(c[6]),
            "classMeetingWeekPatternCode": c[7],
            "locationName": c[8],
            "instructorName": c[9],
        }
        sd, ed = calendar.monthrange(int(year), int(month))
        st = max(cc["scheduleStartDate"], datetime.date(int(year), int(month), 1))
        et = min(cc["scheduleEndDate"], datetime.date(int(year), int(month), ed))

        while st <= et:
            if cc["classMeetingWeekPatternCode"][st.weekday()] == 'Y':
                evs.append({
                    "allday": False,
                    "calendar": calcode,
                    "category": 9,
                    "completed": False,
                    "description": f"{cc['classSection']} - {subcode} {catnum} [{cc['courseComponent']}]<br><br>{cc['locationName']} [{cc['instructorName']}]",
                    "enddate": f"{year}-{f'0{month}' if int(month) < 10 else month}-{f'0{st.day}' if st.day < 10 else st.day}T{cc['classMeetingEndTime'].astimezone(pytz.utc).time()}Z",
                    "id": "!NO_ID!",
                    "location": None,
                    "name": f"{str(cc['classSection']).zfill(3)} - {subcode} {catnum} [{cc['courseComponent']}]",
                    "priority": 10,
                    "public": False,
                    "startdate": f"{year}-{f'0{month}' if int(month) < 10 else month}-{f'0{st.day}' if st.day < 10 else st.day}T{cc['classMeetingStartTime'].astimezone(pytz.utc).time()}Z",
                })
            st += datetime.timedelta(days=1)

    return cals, evs
