#!/usr/bin/env python3
"""Fail-closed updater for the production FairMap coupon detail modal."""

from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path


OLD_STYLE = """.coupon-detail-sheet {
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

NEW_STYLE = """.coupon-detail-sheet {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(100%, 460px);
  max-height: calc(100vh - 24px);
  max-height: calc(100dvh - 24px);
  background: #f7f0df;
  border-radius: 28px 28px 0 0;
  box-shadow: 0 -18px 50px rgba(0, 0, 0, 0.24);
  padding: 54px 14px max(18px, env(safe-area-inset-bottom));
  overflow: hidden;
}

.coupon-detail-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}

.coupon-detail-close {
  position: absolute;
  z-index: 2;
  top: 6px;
  right: 8px;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: #f7f0df;
  font-size: 28px;
  line-height: 1;
  color: #355c31;
  cursor: pointer;
}
"""

OLD_LINK = '<link rel="stylesheet" href="/style.css?v=20260527-product-list-tighten">'
NEW_LINK = '<link rel="stylesheet" href="/style.css?v=20260801-coupon-modal-scroll">'


def require_once(text: str, marker: str, label: str) -> None:
    count = text.count(marker)
    if count != 1:
        raise RuntimeError(f"{label}: expected marker exactly once, found {count}")


def atomic_write(path: Path, text: str) -> None:
    mode = path.stat().st_mode
    fd, temp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, mode)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def resolve_target_files(target_dir: Path) -> tuple[Path, Path]:
    expanded = target_dir.expanduser()
    if expanded.is_symlink():
        raise RuntimeError(f"target directory must not be a symlink: {expanded}")
    target = expanded.resolve(strict=True)
    public_dir = target / "public"
    if public_dir.is_symlink():
        raise RuntimeError(f"public directory must not be a symlink: {public_dir}")
    public_dir.resolve(strict=True)

    paths = (public_dir / "style.css", public_dir / "map.html")
    for path in paths:
        if path.is_symlink():
            raise RuntimeError(f"target file must not be a symlink: {path}")
        resolved = path.resolve(strict=True)
        try:
            resolved.relative_to(target)
        except ValueError as error:
            raise RuntimeError(f"target file escapes target directory: {path}") from error
        if not resolved.is_file():
            raise RuntimeError(f"target is not a regular file: {path}")
    return paths


def update(target_dir: Path, check: bool = False) -> bool:
    style_path, map_path = resolve_target_files(target_dir)
    style = style_path.read_text(encoding="utf-8")
    html = map_path.read_text(encoding="utf-8")

    old_style_count = style.count(OLD_STYLE)
    old_link_count = html.count(OLD_LINK)
    new_style_count = style.count(NEW_STYLE)
    new_link_count = html.count(NEW_LINK)
    if new_style_count or new_link_count:
        if (
            new_style_count == 1
            and new_link_count == 1
            and old_style_count == 0
            and old_link_count == 0
        ):
            return False
        raise RuntimeError(
            "mixed old/new source state; refusing to modify "
            f"(old_style={old_style_count}, old_link={old_link_count}, "
            f"new_style={new_style_count}, new_link={new_link_count})"
        )

    require_once(style, OLD_STYLE, str(style_path))
    require_once(html, OLD_LINK, str(map_path))

    if check:
        return True

    next_style = style.replace(OLD_STYLE, NEW_STYLE, 1)
    next_html = html.replace(OLD_LINK, NEW_LINK, 1)
    atomic_write(style_path, next_style)
    try:
        atomic_write(map_path, next_html)
    except Exception:
        atomic_write(style_path, style)
        raise
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-dir", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        changed = update(args.target_dir, check=args.check)
    except (OSError, RuntimeError) as error:
        print(f"ERROR: {error}", file=os.sys.stderr)
        return 2
    if args.check:
        if changed:
            print("coupon modal scroll fix is required")
            return 1
        print("coupon modal scroll fix is already applied")
        return 0
    print("coupon modal scroll fix applied" if changed else "coupon modal scroll fix already applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
