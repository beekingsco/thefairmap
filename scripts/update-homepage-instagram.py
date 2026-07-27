#!/usr/bin/env python3
"""Replace the expired VFM Easter promotion with the current Instagram post."""

from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path

EXPECTED_TAG_HEADING = "    <h2>Tag @VisitFirstMonday</h2>"
FINAL_TAG_HEADING = "    <h2>Follow @VisitFirstMonday</h2>"

EXPECTED_PROMO_CSS = r'''    .promo-card {
      margin: 26px auto 0;
      max-width: 1000px;
      background: #ece9d9;
      color: #2d2927;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      box-shadow: 0 18px 30px rgba(0, 0, 0, 0.18);
    }

    .promo-card img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      min-height: 100%;
    }

    .promo-copy {
      padding: 28px 28px 22px;
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 14px;
    }

    .promo-copy h3 {
      margin: 0;
      font-size: clamp(24px, 3vw, 38px);
      line-height: 1.16;
      font-weight: 800;
    }

    .promo-copy p {
      margin: 0;
      font-size: 15px;
      line-height: 1.7;
      color: #4a4643;
    }
'''

FINAL_PROMO_CSS = r'''    .instagram-feature {
      margin: 26px auto 0;
      max-width: 1000px;
      background: #ece9d9;
      color: #2d2927;
      display: grid;
      grid-template-columns:minmax(0,1.15fr) minmax(280px,0.85fr);
      gap: 0;
      box-shadow: 0 18px 30px rgba(0, 0, 0, 0.18);
      overflow: hidden;
    }

    .instagram-embed-shell {
      min-width: 0;
      background: #fff;
      display: flex;
      align-items: stretch;
      justify-content: center;
    }

    .instagram-embed {
      display: block;
      width:100%;
      height: 760px;
      border: 0;
      background: #fff;
    }

    .instagram-copy {
      padding: 34px 30px;
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 16px;
    }

    .instagram-eyebrow {
      color: #6b4f22;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .instagram-copy h3 {
      margin: 0;
      font-size: clamp(25px, 3vw, 38px);
      line-height: 1.14;
      font-weight: 800;
    }

    .instagram-copy p {
      margin: 0;
      font-size: 15px;
      line-height: 1.7;
      color: #4a4643;
    }

    .instagram-follow-link {
      min-height:44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 11px 20px;
      border-radius: 999px;
      background: #075d43;
      color: #fff;
      font-size: 15px;
      font-weight: 800;
      text-decoration: none;
    }

    .instagram-follow-link:hover,
    .instagram-follow-link:focus-visible {
      background: #043f2d;
      outline: 3px solid #c79b45;
      outline-offset: 3px;
    }

    .instagram-post-link {
      color: #3d352d;
      font-size: 13px;
      font-weight: 700;
      text-underline-offset: 3px;
    }

    @media (max-width:900px) {
      .instagram-feature {
        grid-template-columns:1fr;
        max-width: 620px;
      }

      .instagram-embed {
        height:680px;
      }
    }

    @media (max-width:420px) {
      .instagram-copy {
        padding: 26px 20px 28px;
      }

      .instagram-embed {
        height: 650px;
      }
    }
'''

EXPECTED_PROMO_HTML = r'''      <div class="promo-card">
        <img src="https://statics.myclickfunnels.com/workspace/eOQKpZ/image/21536406/file/4df68bf83c0bb4de1cc1acb4dd4a5c8f.jpg" alt="Easter egg hunt promo">
        <div class="promo-copy">
          <h3>It's the GREAT Easter Egg Hunt!<br>$1000 Cash Prize! April 2-5th</h3>
          <p>At First Monday, you never know what kind of magic you'll stumble into and this Easter weekend, we're making it extra special.</p>
          <p>Join us for The Great Easter Egg Hunt, where families can enjoy a FREE, fun-filled adventure across Trade Days for a chance to win a $1,000 CASH prize.</p>
          <p>It's the perfect way to add even more excitement to your shopping trip, with surprises around every corner and something the whole family can enjoy together.</p>
          <p><strong>Best of all? It's completely FREE to play.</strong></p>
        </div>
      </div>'''

FINAL_PROMO_HTML = r'''      <div class="instagram-feature">
        <div class="instagram-embed-shell">
          <iframe class="instagram-embed" src="https://www.instagram.com/reel/DbTB-_aBA_L/embed/captioned/" title="Latest Instagram post from @visitfirstmonday" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowfullscreen></iframe>
        </div>
        <div class="instagram-copy">
          <span class="instagram-eyebrow">Fresh from First Monday</span>
          <h3>Follow us @visitfirstmonday</h3>
          <p>Get the latest market countdowns, vendor spotlights, parking tips, and can't-miss finds straight from Canton. Follow @visitfirstmonday on Instagram and see what's happening before your next trip.</p>
          <a class="instagram-follow-link" href="https://www.instagram.com/visitfirstmonday/" target="_blank" rel="noopener noreferrer">Follow @visitfirstmonday</a>
          <a class="instagram-post-link" href="https://www.instagram.com/visitfirstmonday/reel/DbTB-_aBA_L/" target="_blank" rel="noopener noreferrer">View this post on Instagram</a>
        </div>
      </div>'''


def replace_validated(source: str, expected: str, final: str, label: str) -> str:
    expected_count = source.count(expected)
    final_count = source.count(final)
    if final_count == 1 and expected_count == 0:
        return source
    if expected_count != 1 or final_count != 0:
        raise ValueError(f"{label} did not match exactly one reviewed source or one complete final block")
    return source.replace(expected, final, 1)


def updated_source(source: str) -> str:
    updated = replace_validated(source, EXPECTED_PROMO_CSS, FINAL_PROMO_CSS, "promotion styles")
    updated = replace_validated(updated, EXPECTED_TAG_HEADING, FINAL_TAG_HEADING, "tag heading")
    updated = replace_validated(updated, EXPECTED_PROMO_HTML, FINAL_PROMO_HTML, "promotion markup")
    return updated


def write_atomic(path: Path, content: bytes) -> None:
    mode = path.stat().st_mode
    temporary_name = ""
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as temporary:
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_name = temporary.name
        os.chmod(temporary_name, mode)
        os.replace(temporary_name, path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def update_file(path: Path, *, write: bool = True) -> bool:
    original = path.read_bytes()
    updated = updated_source(original.decode("utf-8")).encode("utf-8")
    if updated == original:
        return False
    if write:
        write_atomic(path, updated)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=Path("public/vfm-homepage.html"))
    parser.add_argument("--check", action="store_true", help="exit 1 when the homepage still needs the update")
    args = parser.parse_args()
    if not args.path.is_file():
        parser.error(f"file not found: {args.path}")
    try:
        changed = update_file(args.path, write=not args.check)
    except (UnicodeDecodeError, ValueError) as exc:
        parser.error(str(exc))
    if args.check:
        print("Homepage Instagram feature needs update" if changed else "Homepage Instagram feature is ready")
        return 1 if changed else 0
    print("Updated homepage Instagram feature" if changed else "Homepage Instagram feature already ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
