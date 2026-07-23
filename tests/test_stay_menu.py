import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from add_stay_menu import update_file


class StayMenuTests(unittest.TestCase):
    def test_adds_stay_to_desktop_and_mobile_header_only(self):
        page = '''<!doctype html>
<header class="site-header texture">
  <nav class="nav"><a href="/app-download">Maps</a><a href="/blog">Blog</a></nav>
  <div class="mobile-nav"><a href="/app-download">Maps</a><a href="/blog">Blog</a></div>
</header>
<main><a href="/app-download">Download the map</a></main>
'''
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "index.html"
            path.write_text(page)
            self.assertTrue(update_file(path))
            updated = path.read_text()
            header = updated.split("</header>", 1)[0]
            body = updated.split("</header>", 1)[1]
            self.assertEqual(header.count('href="/stay"'), 2)
            self.assertEqual(body.count('href="/stay"'), 0)
            self.assertIn('<a href="/app-download">Maps</a><a href="/stay">Stay</a>', header)

    def test_is_idempotent(self):
        page = '''<header class="site-header"><nav><a href="/app-download">Maps</a></nav></header>'''
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "index.html"
            path.write_text(page)
            self.assertTrue(update_file(path))
            first = path.read_text()
            self.assertFalse(update_file(path))
            self.assertEqual(path.read_text(), first)
            self.assertEqual(first.count('href="/stay"'), 1)

    def test_skips_unrelated_headers(self):
        page = '''<header class="other"><a href="/app-download">Maps</a></header>'''
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "index.html"
            path.write_text(page)
            self.assertFalse(update_file(path))
            self.assertEqual(path.read_text(), page)


if __name__ == "__main__":
    unittest.main()
