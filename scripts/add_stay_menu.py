#!/usr/bin/env python3
"""Add the Visit First Monday Stay link to desktop and mobile site headers."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

HEADER_RE = re.compile(
    r'<header\b(?=[^>]*\bclass=["\'][^"\']*\bsite-header\b[^"\']*["\'])[^>]*>.*?</header>',
    re.IGNORECASE | re.DOTALL,
)
MAP_LINK_RE = re.compile(
    r'(?P<link><a\b[^>]*\bhref=["\']/(?:app-download|app-download-staging)["\'][^>]*>[^<]*</a>)'
    r'(?!\s*<a\b[^>]*\bhref=["\'](?:/stay|https://www\.visitfirstmonday\.com/stay)["\'])',
    re.IGNORECASE | re.DOTALL,
)


def updated_source(source: str) -> str:
    def update_header(match: re.Match[str]) -> str:
        header = match.group(0)

        def add_link(link_match: re.Match[str]) -> str:
            following = link_match.string[link_match.end():]
            whitespace_match = re.match(r"\s*", following)
            whitespace = whitespace_match.group(0) if whitespace_match else ""
            return f'{link_match.group("link")}{whitespace}<a href="/stay">Stay</a>'

        return MAP_LINK_RE.sub(add_link, header)

    return HEADER_RE.sub(update_header, source)


def update_file(path: Path, *, write: bool = True) -> bool:
    source = path.read_text(encoding="utf-8")
    updated = updated_source(source)
    if updated == source:
        return False
    if write:
        path.write_text(updated, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default="public", type=Path)
    parser.add_argument("--check", action="store_true", help="report files that still need the Stay link without modifying them")
    args = parser.parse_args()

    changed = []
    for path in sorted(args.root.rglob("*.html")):
        if update_file(path, write=not args.check):
            changed.append(path)

    for path in changed:
        print(path)

    if args.check and changed:
        print(f"{len(changed)} file(s) need the Stay menu link")
        return 1

    print(f"Updated {len(changed)} file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
