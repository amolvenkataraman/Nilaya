import secrets

from django.db import models


def random_characters(length: int = 32):
    """A URL-safe random string (profile picture file names)."""
    return secrets.token_urlsafe(length)


def get_model_attrs(obj, attrs: list):
    """{attr: value} for the given attributes (dates as strings)."""
    ans = {}
    for attr in attrs:
        temp = getattr(obj, attr)
        if isinstance(temp, models.DateField) or isinstance(temp, models.DateTimeField):
            temp = str(temp)
        ans[attr] = temp
    return ans
