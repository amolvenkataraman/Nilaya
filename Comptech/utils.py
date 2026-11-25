import secrets


def random_characters(length: int = 32):
    """A URL-safe random string (profile picture file names)."""
    return secrets.token_urlsafe(length)
