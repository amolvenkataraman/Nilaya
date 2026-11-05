import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('map', '0003_alter_location_category_alter_location_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='location',
            name='status',
            field=models.CharField(choices=[('saved', 'Saved'), ('want_to_go', 'Want to go'), ('visited', 'Visited')], default='saved', max_length=12),
        ),
        migrations.AddField(
            model_name='location',
            name='visited_on',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='location',
            name='updated_on',
            field=models.DateTimeField(auto_now=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
    ]
