from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('photos', '0018_alter_album_subscriber_options_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='photo',
            name='md5_hash',
            field=models.CharField(
                blank=True,
                db_index=True,
                max_length=32,
                null=True,
                help_text='MD5 of the file bytes — exact duplicate detection',
            ),
        ),
        migrations.AddField(
            model_name='photo',
            name='phash',
            field=models.CharField(
                blank=True,
                db_index=True,
                max_length=64,
                null=True,
                help_text='256-bit perceptual hash — near-duplicate detection (Hamming ≤ 8 = near-dup)',
            ),
        ),
    ]
