import re
from pathlib import Path

from django.test import SimpleTestCase

TEMPLATES = Path(__file__).resolve().parent / "templates" / "scheduler"


class NoInlineAssetsTests(SimpleTestCase):
    """Calendar templates keep JS/CSS in static files: no inline <script>/<style>, style="" or on*="" handlers."""

    def test_templates_have_no_inline_js_or_css(self):
        inline = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>|<style\b|\sstyle\s*=|\son[a-z]+\s*=", re.I)
        for path in TEMPLATES.glob("*.html"):
            with self.subTest(template=path.name):
                self.assertEqual(inline.findall(path.read_text()), [])
