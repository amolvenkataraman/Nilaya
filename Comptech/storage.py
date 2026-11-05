"""Static files with content hashes in their names (styles.4f1c2a.css), so nginx can cache them
forever (`expires max`) and a changed file always reaches browsers under a new name.

Lenient: a reference to a missing file (a CSS url() or a source map a vendor library doesn't ship)
stays as written instead of failing collectstatic, and a name missing from the manifest falls back
to the plain path instead of a server error."""

from django.contrib.staticfiles.storage import ManifestStaticFilesStorage


class LenientManifestStorage(ManifestStaticFilesStorage):
    manifest_strict = False
    # Also rewrite ES module imports (import ... from "./lib.js"): the classic Tasks/Habits/Contacts
    # pages load modules by plain name, which nginx would otherwise cache forever.
    support_js_module_import_aggregation = True

    def url_converter(self, name, hashed_files, template=None):
        if name.startswith("app/") and template and template.startswith(("import", "export")):
            # The React build (Vite) already has content-hashed chunk names, and its chunks import
            # each other in cycles, which name rewriting can't settle: leave its imports as built.
            return lambda match: match["matched"]
        return super().url_converter(name, hashed_files, template)

    def hashed_name(self, name, content=None, filename=None):
        try:
            return super().hashed_name(name, content, filename)
        except ValueError:  # the referenced file doesn't exist
            return name
