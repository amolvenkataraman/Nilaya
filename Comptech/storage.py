"""Static files with content hashes in their names (styles.4f1c2a.css), so nginx can cache them
forever (`expires max`) and a changed file always reaches browsers under a new name.

Lenient: a reference to a missing file (a CSS url() or a source map a vendor library doesn't ship)
stays as written instead of failing collectstatic, and a name missing from the manifest falls back
to the plain path instead of a server error."""

from django.contrib.staticfiles.storage import ManifestStaticFilesStorage


class LenientManifestStorage(ManifestStaticFilesStorage):
    manifest_strict = False

    def hashed_name(self, name, content=None, filename=None):
        try:
            return super().hashed_name(name, content, filename)
        except ValueError:  # the referenced file doesn't exist
            return name
