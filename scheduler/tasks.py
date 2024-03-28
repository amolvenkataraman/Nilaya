from datetime import datetime
from celery import shared_task
from celery.utils.log import get_task_logger

from Comptech.settings import ONLINE_MODE
from scheduler.models import *
from scheduler.sync import *
from django.utils import timezone
import datetime

logger = get_task_logger(__name__)


@shared_task
def autosync_calendars():
    if ONLINE_MODE:
        c = Calendar.objects.filter(calendar_type__gt=0, auto_sync=True, active=True)
        for cal in c:
            print(f"Syncing {cal.name}...")
            try:
                tzoffset = datetime.datetime.now(pytz.timezone(timezone.get_current_timezone_name())).strftime('%z')

                if cal.auto_sync_sy == -1 and cal.auto_sync_sm == -1:
                    d = datetime.datetime.now()
                    start_time = f"{d.year}-{d.month}-01T00:00:00{tzoffset}"
                else:
                    start_time = f"{cal.auto_sync_sy}-{cal.auto_sync_sm}-01T00:00:00{tzoffset}"

                end_time = f"{cal.auto_sync_ey}-{cal.auto_sync_em}-01T00:00:00{tzoffset}"

                if cal.calendar_type == 1: # ICalendar:
                    status = sync_ical(cal, start_time, end_time) ## ACTUAL SYNC

                elif cal.calendar_type == 2: # Public Google Calendar
                    status = sync_google(cal, start_time, end_time, None) ## ACTUAL SYNC

                elif cal.calendar_type == 50: # UWaterloo WCMS
                    status = sync_uwaterloo(cal, start_time, end_time)

                print(f"{cal.name} has been synced!")

            except: print(f"An error ocurred syncing {cal.name}")
    else:
        print("Calendar sync task has been cancelled because the server is in offline mode.")

