"""Static files (Django admin's, and the app's build in app/) with content hashes in their names, so
nginx can cache them forever (`expires max`) and a changed file always reaches browsers under a new name.

Lenient: a reference to a missing file (a CSS url() or a source map a vendor library doesn't ship)
stays as written instead of failing collectstatic, and a name missing from the manifest falls back
to the plain path instead of a server error."""

from django.contrib.staticfiles.storage import ManifestStaticFilesStorage


class LenientManifestStorage(ManifestStaticFilesStorage):
    manifest_strict = False
    # JS imports are left as written: the app's Vite chunks already have content-hashed names (and
    # import each other in cycles, which name rewriting can't settle); admin JS has no imports.

    def hashed_name(self, name, content=None, filename=None):
        try:
            return super().hashed_name(name, content, filename)
        except ValueError:  # the referenced file doesn't exist
            return name

    def stored_name(self, name):
        """The hashed name from staticfiles.json, or the plain name. Never hash on the fly: a hash of
        the raw file doesn't match the post-processed copy collectstatic wrote (CSS url() and import
        rewrites change the content), so an invented name would 404. Missing entries mean
        collectstatic hasn't run (or failed); the plain file still exists and loads."""
        parsed = name.split("?", 1)[0].split("#", 1)[0]
        hashed = self.hashed_files.get(self.hash_key(self.clean_name(parsed)))
        if hashed is None:
            return name
        return hashed + name[len(parsed):]

