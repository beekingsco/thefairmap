import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "update-homepage-instagram.py"
POST_URL = "https://www.instagram.com/visitfirstmonday/reel/DbTB-_aBA_L/"
EMBED_URL = "https://www.instagram.com/reel/DbTB-_aBA_L/embed/captioned/"


def load_module():
    spec = importlib.util.spec_from_file_location("update_homepage_instagram", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


def fixture(module):
    return (
        "<!doctype html><style>\n"
        + module.EXPECTED_PROMO_CSS
        + "\n</style><body>\n"
        + module.EXPECTED_TAG_HEADING
        + "\n"
        + module.EXPECTED_PROMO_HTML
        + "\n</body>"
    )


class HomepageInstagramUpdateTests(unittest.TestCase):
    def test_replaces_easter_promotion_with_current_instagram_post(self):
        module = load_module()
        updated = module.updated_source(fixture(module))
        self.assertNotIn("Easter", updated)
        self.assertNotIn("$1000", updated)
        self.assertNotIn("4df68bf83c0bb4de1cc1acb4dd4a5c8f.jpg", updated)
        self.assertIn(EMBED_URL, updated)
        self.assertIn(POST_URL, updated)
        self.assertIn("Follow us @visitfirstmonday", updated)
        self.assertIn("Follow @visitfirstmonday", updated)
        self.assertIn('title="Latest Instagram post from @visitfirstmonday"', updated)
        self.assertIn('loading="lazy"', updated)
        self.assertIn('referrerpolicy="strict-origin-when-cross-origin"', updated)
        self.assertIn('class="instagram-follow-link"', updated)

    def test_embed_is_responsive_and_cta_is_touch_sized(self):
        module = load_module()
        updated = module.updated_source(fixture(module))
        self.assertIn("grid-template-columns:minmax(0,1.15fr) minmax(280px,0.85fr)", updated)
        self.assertIn(".instagram-embed", updated)
        self.assertIn("width:100%", updated)
        self.assertIn("min-height:44px", updated)
        self.assertIn("@media (max-width:900px)", updated)
        self.assertIn("grid-template-columns:1fr", updated)
        self.assertIn("height:680px", updated)

    def test_is_idempotent_and_preserves_unrelated_bytes(self):
        module = load_module()
        original = "PREFIX\r\n" + fixture(module) + "\r\nSUFFIX"
        first = module.updated_source(original)
        self.assertEqual(module.updated_source(first), first)
        self.assertTrue(first.startswith("PREFIX\r\n"))
        self.assertTrue(first.endswith("\r\nSUFFIX"))

    def test_rejects_duplicate_or_modified_source_blocks(self):
        module = load_module()
        with self.assertRaises(ValueError):
            module.updated_source(fixture(module) + "\n" + module.EXPECTED_PROMO_HTML)
        modified = fixture(module).replace("$1000 Cash Prize", "$999 Cash Prize", 1)
        with self.assertRaises(ValueError):
            module.updated_source(modified)

    def test_batch_updates_index_and_homepage_atomically(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            homepage = root / "vfm-homepage.html"
            index = root / "index.html"
            homepage.write_text(fixture(module))
            index.write_text(fixture(module))
            self.assertEqual(module.update_files([homepage, index], write=False), 2)
            self.assertEqual(module.update_files([homepage, index], write=True), 2)
            self.assertEqual(module.update_files([homepage, index], write=False), 0)

            homepage.write_text(fixture(module))
            index.write_text("malformed source")
            with self.assertRaises(ValueError):
                module.update_files([homepage, index], write=True)
            self.assertEqual(homepage.read_text(), fixture(module))

    def test_cli_requires_explicit_production_paths(self):
        result = subprocess.run(
            ["python3", str(SCRIPT), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("the following arguments are required: paths", result.stderr)

    def test_file_check_and_write_modes(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "vfm-homepage.html"
            original = fixture(module)
            path.write_text(original)
            self.assertTrue(module.update_file(path, write=False))
            self.assertEqual(path.read_text(), original)
            self.assertTrue(module.update_file(path, write=True))
            self.assertFalse(module.update_file(path, write=False))


if __name__ == "__main__":
    unittest.main()
