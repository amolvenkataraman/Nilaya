import datetime, pytz
from django.utils import timezone
from scheduler.sync import *

def sync_sjam_calendar():
    tzoffset = datetime.datetime.now(pytz.timezone(timezone.get_current_timezone_name())).strftime('%z')
    start_time = f"2022-01-01T00:00:00{tzoffset}"
    end_time = f"2022-06-01T00:00:00{tzoffset}"
    sync_google(4, start_time, end_time, None)
