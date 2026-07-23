import subprocess
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

    def test_requires_exact_site_header_class_token(self):
        page = '''<header class="not-site-header"><a href="/app-download">Maps</a></header>
<header class="site-header-secondary"><a href="/app-download">Maps</a></header>
<header class="texture site-header sticky"><a href="/app-download">Maps</a></header>'''
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "index.html"
            path.write_text(page)
            self.assertTrue(update_file(path))
            updated = path.read_text()
            self.assertEqual(updated.count('href="/stay"'), 1)
            self.assertNotIn('not-site-header"><a href="/app-download">Maps</a><a href="/stay"', updated)
            self.assertNotIn('site-header-secondary"><a href="/app-download">Maps</a><a href="/stay"', updated)

    def test_ignores_comment_markup_and_supports_nested_anchor_content(self):
        page = '''<header class="site-header"><nav>
<!-- <a href="/app-download">Commented Maps</a> -->
<a href="/app-download"><span>Maps</span></a>
</nav></header>'''
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "index.html"
            path.write_text(page)
            self.assertTrue(update_file(path))
            updated = path.read_text()
            self.assertIn('<!-- <a href="/app-download">Commented Maps</a> -->', updated)
            self.assertEqual(updated.count('href="/stay"'), 1)
            self.assertIn('</span></a>\n<a href="/stay">Stay</a>', updated)

    def test_preserves_crlf_newlines(self):
        page = b'<header class="site-header">\r\n  <a href="/app-download"><span>Maps</span></a>\r\n  <a href="/blog">Blog</a>\r\n</header>\r\n'
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "index.html"
            path.write_bytes(page)
            self.assertTrue(update_file(path))
            updated = path.read_bytes()
            self.assertEqual(updated.count(b"\n"), updated.count(b"\r\n"))
            self.assertIn(b'\r\n  <a href="/stay">Stay</a>\r\n  <a href="/blog">', updated)

    def test_existing_absolute_stay_link_is_clean(self):
        page = '''<header class="site-header"><a href="/app-download">Maps</a><a href="https://www.visitfirstmonday.com/stay">Stay</a></header>'''
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "index.html"
            path.write_text(page)
            self.assertFalse(update_file(path))

    def test_cli_fails_for_missing_or_empty_roots(self):
        script = ROOT / "scripts" / "add_stay_menu.py"
        missing = subprocess.run([sys.executable, str(script), "--check", "/definitely/missing/vfm-public"], capture_output=True, text=True)
        self.assertNotEqual(missing.returncode, 0)
        with tempfile.TemporaryDirectory() as tmp:
            empty = subprocess.run([sys.executable, str(script), "--check", tmp], capture_output=True, text=True)
            self.assertNotEqual(empty.returncode, 0)

    def test_cli_fails_when_html_has_no_recognized_menu_targets(self):
        script = ROOT / "scripts" / "add_stay_menu.py"
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "plain.html").write_text('<header class="other"><a href="/app-download">Maps</a></header>')
            result = subprocess.run([sys.executable, str(script), "--check", tmp], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("no Visit First Monday map-menu targets", result.stderr)

    def test_malformed_html_aborts_batch_before_any_file_is_written(self):
        script = ROOT / "scripts" / "add_stay_menu.py"
        valid = '<header class="site-header"><a href="/app-download">Maps</a></header>'
        malformed = '<header class="site-header"><a href="/app-download">Maps<header class="other"></a></header></header>'
        with tempfile.TemporaryDirectory() as tmp:
            valid_path = Path(tmp, "a-valid.html")
            malformed_path = Path(tmp, "z-malformed.html")
            valid_path.write_text(valid)
            malformed_path.write_text(malformed)
            result = subprocess.run([sys.executable, str(script), tmp], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("malformed menu HTML", result.stderr)
            self.assertEqual(valid_path.read_text(), valid)
            self.assertEqual(malformed_path.read_text(), malformed)

    def test_update_file_rejects_unclosed_site_header(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "index.html")
            path.write_text('<header class="site-header"><a href="/app-download">Maps</a>')
            with self.assertRaises(ValueError):
                update_file(path)

    def test_rejects_incomplete_and_merged_site_header_openers(self):
        cases = [
            '<header class="site-header"',
            '<header class="site-header"\n<header class="site-header"><a href="/app-download">Maps</a></header>',
        ]
        for index, source in enumerate(cases):
            with self.subTest(index=index), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp, "index.html")
                path.write_text(source)
                with self.assertRaises(ValueError):
                    update_file(path)
                self.assertEqual(path.read_text(), source)

    def test_unicode_whitespace_does_not_create_site_header_class_token(self):
        for whitespace in ("\u00a0", "\u2003"):
            for classes in (f"{whitespace}site-header", f"site-header{whitespace}"):
                with self.subTest(classes=classes), tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp, "index.html")
                    source = f'<header class="{classes}"><a href="/app-download">Maps</a></header>'
                    path.write_text(source)
                    self.assertFalse(update_file(path))
                    self.assertEqual(path.read_text(), source)


if __name__ == "__main__":
    unittest.main()
