import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UPDATER = ROOT / "scripts" / "fix-coupon-modal-scroll.py"

OLD_SHEET = """.coupon-detail-sheet {
  position: relative;
  width: min(100%, 460px);
  max-height: min(86dvh, 820px);
  background: #f7f0df;
  border-radius: 28px 28px 0 0;
  box-shadow: 0 -18px 50px rgba(0, 0, 0, 0.24);
  padding: 42px 14px 18px;
  overflow: hidden;
}

.coupon-detail-body {
  max-height: calc(min(86dvh, 820px) - 60px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.coupon-detail-close {
  position: absolute;
  top: 10px;
  right: 12px;
  border: none;
  background: none;
  font-size: 28px;
  line-height: 1;
  color: #355c31;
  cursor: pointer;
}
"""

OLD_LINK = '<link rel="stylesheet" href="/style.css?v=20260527-product-list-tighten">'
NEW_LINK = '<link rel="stylesheet" href="/style.css?v=20260801-coupon-modal-scroll">'


def make_target(root: Path):
    public = root / "public"
    public.mkdir(parents=True)
    (public / "style.css").write_text(
        "before\n" + OLD_SHEET + "@media (min-width: 720px) {\n"
        "  .coupon-detail-sheet {\n    border-radius: 28px;\n  }\n}\n"
        "after\n"
    )
    (public / "map.html").write_text("<head>\n  " + OLD_LINK + "\n</head>\n")


class CouponModalScrollUpdaterTests(unittest.TestCase):
    def run_updater(self, target: Path, *extra):
        return subprocess.run(
            [sys.executable, str(UPDATER), "--target-dir", str(target), *extra],
            text=True,
            capture_output=True,
        )

    def test_updates_modal_to_scroll_with_viewport_fallback_and_fixed_close_control(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            make_target(target)

            result = self.run_updater(target)

            self.assertEqual(result.returncode, 0, result.stderr)
            css = (target / "public/style.css").read_text()
            html = (target / "public/map.html").read_text()
            self.assertIn("max-height: calc(100vh - 24px);", css)
            self.assertIn("max-height: calc(100dvh - 24px);", css)
            self.assertLess(css.index("100vh"), css.index("100dvh"))
            self.assertIn("display: flex;", css)
            self.assertIn("flex-direction: column;", css)
            self.assertIn("min-height: 0;", css)
            self.assertIn("overflow-y: auto;", css)
            self.assertIn("touch-action: pan-y;", css)
            self.assertIn("overscroll-behavior: contain;", css)
            self.assertIn("width: 44px;", css)
            self.assertIn("height: 44px;", css)
            self.assertIn("z-index: 2;", css)
            self.assertIn('/style.css?v=20260801-coupon-modal-scroll', html)
            self.assertNotIn(OLD_LINK, html)

    def test_check_mode_is_read_only_and_reports_required_then_applied(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            make_target(target)
            style_path = target / "public/style.css"
            map_path = target / "public/map.html"
            before = (style_path.read_bytes(), map_path.read_bytes())

            required = self.run_updater(target, "--check")

            self.assertEqual(required.returncode, 1, required.stderr)
            self.assertEqual((style_path.read_bytes(), map_path.read_bytes()), before)
            self.assertEqual(self.run_updater(target).returncode, 0)
            applied = self.run_updater(target, "--check")
            self.assertEqual(applied.returncode, 0, applied.stderr)

    def test_source_drift_fails_closed_without_partial_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            make_target(target)
            style_path = target / "public/style.css"
            map_path = target / "public/map.html"
            map_path.write_text(map_path.read_text().replace(OLD_LINK, "<link rel=\"stylesheet\" href=\"/style.css?v=unexpected\">"))
            before = (style_path.read_bytes(), map_path.read_bytes())

            result = self.run_updater(target)

            self.assertEqual(result.returncode, 2)
            self.assertIn("expected marker exactly once, found 0", result.stderr)
            self.assertEqual((style_path.read_bytes(), map_path.read_bytes()), before)

    def test_second_apply_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            make_target(target)
            self.assertEqual(self.run_updater(target).returncode, 0)
            style_path = target / "public/style.css"
            map_path = target / "public/map.html"
            applied = (style_path.read_bytes(), map_path.read_bytes())

            second = self.run_updater(target)

            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn("already applied", second.stdout)
            self.assertEqual((style_path.read_bytes(), map_path.read_bytes()), applied)

    def test_mixed_old_and_new_source_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            make_target(target)
            style_path = target / "public/style.css"
            map_path = target / "public/map.html"
            map_path.write_text(map_path.read_text() + NEW_LINK + "\n")
            before = (style_path.read_bytes(), map_path.read_bytes())

            result = self.run_updater(target)

            self.assertEqual(result.returncode, 2)
            self.assertIn("mixed old/new source state", result.stderr)
            self.assertEqual((style_path.read_bytes(), map_path.read_bytes()), before)

    def test_symlinked_public_directory_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as outside:
            target = Path(tmp)
            outside_target = Path(outside)
            make_target(outside_target)
            (target / "public").symlink_to(outside_target / "public", target_is_directory=True)
            before = (
                (outside_target / "public/style.css").read_bytes(),
                (outside_target / "public/map.html").read_bytes(),
            )

            result = self.run_updater(target)

            self.assertEqual(result.returncode, 2)
            self.assertIn("symlink", result.stderr.lower())
            self.assertEqual(
                (
                    (outside_target / "public/style.css").read_bytes(),
                    (outside_target / "public/map.html").read_bytes(),
                ),
                before,
            )

    def test_target_directory_is_required(self):
        result = subprocess.run(
            [sys.executable, str(UPDATER), "--check"],
            text=True,
            capture_output=True,
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("--target-dir", result.stderr)


if __name__ == "__main__":
    unittest.main()
