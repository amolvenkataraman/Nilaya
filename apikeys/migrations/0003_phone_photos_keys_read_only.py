"""Phone Photos keys become read-only (the phone app never changes the library): keys already issued to a
device with photos:write get photos:read instead, the scope new phone keys get. Keys people made
themselves in Settings are left alone. Reversing gives the write scope back."""

from django.db import migrations


def _swap(apps, old, new):
    ApiKey = apps.get_model("apikeys", "ApiKey")
    changed = []
    for key in ApiKey.objects.filter(device__isnull=False).only("id", "scopes"):
        if old in key.scopes:
            key.scopes = sorted((set(key.scopes) - {old}) | {new})
            changed.append(key)
    ApiKey.objects.bulk_update(changed, ["scopes"])


class Migration(migrations.Migration):
    dependencies = [("apikeys", "0002_device")]

    operations = [
        migrations.RunPython(lambda apps, _: _swap(apps, "photos:write", "photos:read"),
                             lambda apps, _: _swap(apps, "photos:read", "photos:write")),
    ]
