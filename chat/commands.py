from .models import *
from users.models import *

def create_dm(users, name=None):
    dm = DirectMessage(name=name)
    dm.save()
    for user in users:
        dmu = new = DMUser(dm=dm, user_id=user)
        dmu.save()
    return dm
