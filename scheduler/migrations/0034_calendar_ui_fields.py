"""Calendar schema overhaul, step 1 of 4: the additive fields the calendar UIs need first
(calendar icon/description, event colour/icon, per-calendar reminder mute, invite
expiry/max uses/role). Every column has a default or is nullable: existing rows and old
code keep working with only this migration applied."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('scheduler', '0033_todo_bucket_todo_colour_todo_created_on_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='calendar',
            name='description',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='calendar',
            name='icon',
            field=models.CharField(blank=True, default='', max_length=24),
        ),
        migrations.AddField(
            model_name='event',
            name='colour',
            field=models.CharField(blank=True, max_length=7, null=True),
        ),
        migrations.AddField(
            model_name='event',
            name='icon',
            field=models.CharField(blank=True, max_length=24, null=True),
        ),
        migrations.AddField(
            model_name='invite',
            name='expires_on',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='invite',
            name='max_uses',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='invite',
            name='role',
            field=models.PositiveSmallIntegerField(choices=[(1, 'Admin'), (2, 'Subscriber')], default=2),
        ),
        migrations.AddField(
            model_name='subscriber',
            name='notify',
            field=models.BooleanField(default=True),
        ),
    ]
