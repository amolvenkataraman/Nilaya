"""Calendar schema overhaul, step 4 of 4: the indexes, the unique (calendar, sync_id)
(duplicates were cleared by step 3) and the removal of the retired columns, whose values
step 3 converted: priority/completed → custom_info, public → visibility,
repeat_every/repeat_end → rrule, auto_sync_sm/sy/em/ey → sync_past/future_months.
Reversible: the columns come back and step 3's reverse refills them."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('scheduler', '0036_calendar_schema_data'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='calendar',
            name='auto_sync_em',
        ),
        migrations.RemoveField(
            model_name='calendar',
            name='auto_sync_ey',
        ),
        migrations.RemoveField(
            model_name='calendar',
            name='auto_sync_sm',
        ),
        migrations.RemoveField(
            model_name='calendar',
            name='auto_sync_sy',
        ),
        migrations.RemoveField(
            model_name='event',
            name='completed',
        ),
        migrations.RemoveField(
            model_name='event',
            name='priority',
        ),
        migrations.RemoveField(
            model_name='event',
            name='public',
        ),
        migrations.RemoveField(
            model_name='event',
            name='repeat_end',
        ),
        migrations.RemoveField(
            model_name='event',
            name='repeat_every',
        ),
        migrations.AddIndex(
            model_name='event',
            index=models.Index(fields=['calendar', 'startdate'], name='scheduler_event_cal_start'),
        ),
        migrations.AddIndex(
            model_name='event',
            index=models.Index(fields=['calendar', 'enddate'], name='scheduler_event_cal_end'),
        ),
        migrations.AddConstraint(
            model_name='event',
            constraint=models.UniqueConstraint(condition=models.Q(('sync_id__isnull', False)), fields=('calendar', 'sync_id'), name='scheduler_event_cal_sync_id_uniq'),
        ),
    ]
