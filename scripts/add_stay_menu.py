#!/usr/bin/env python3
"""Add the Visit First Monday Stay link to desktop and mobile site headers."""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

MAP_HREFS = {"/app-download", "/app-download-staging"}
STAY_HREFS = {"/stay", "https://www.visitfirstmonday.com/stay"}


class MenuHeaderParser(HTMLParser):
    """Collect menu anchors and source insertion points without rewriting HTML."""

    def __init__(self, source: str) -> None:
        super().__init__(convert_charrefs=False)
        self.source = source
        self.line_offsets = [0]
        for match in re.finditer(r"\n", source):
            self.line_offsets.append(match.end())
        self.header_stack: list[dict[str, Any] | None] = []
        self.anchor_stack: list[tuple[dict[str, Any], dict[str, Any]]] = []
        self.insertions: list[int] = []
        self.target_count = 0

    def source_index(self) -> int:
        line, column = self.getpos()
        return self.line_offsets[line - 1] + column

    def active_header(self) -> dict[str, Any] | None:
        for header in reversed(self.header_stack):
            if header is not None:
                return header
        return None

    @staticmethod
    def is_site_header(attrs: list[tuple[str, str | None]]) -> bool:
        classes = next((value or "" for name, value in attrs if name.lower() == "class"), "")
        return "site-header" in classes.split()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "header":
            self.header_stack.append({"anchors": []} if self.is_site_header(attrs) else None)
            return
        if tag != "a":
            return
        header = self.active_header()
        if header is None:
            return
        href = next((value or "" for name, value in attrs if name.lower() == "href"), "")
        anchor = {"href": href, "end": None}
        header["anchors"].append(anchor)
        self.anchor_stack.append((header, anchor))

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "a" and self.anchor_stack:
            _header, anchor = self.anchor_stack.pop()
            start = self.source_index()
            closing = self.source.find(">", start)
            if closing >= 0:
                anchor["end"] = closing + 1
            return
        if tag == "header" and self.header_stack:
            header = self.header_stack.pop()
            if header is not None:
                self.finalize_header(header)

    def finalize_header(self, header: dict[str, Any]) -> None:
        anchors = [anchor for anchor in header["anchors"] if anchor["end"] is not None]
        for index, anchor in enumerate(anchors):
            if anchor["href"] not in MAP_HREFS:
                continue
            self.target_count += 1
            next_href = anchors[index + 1]["href"] if index + 1 < len(anchors) else ""
            if next_href not in STAY_HREFS:
                self.insertions.append(anchor["end"])


def analyze_source(source: str) -> tuple[str, int]:
    parser = MenuHeaderParser(source)
    parser.feed(source)
    parser.close()

    updated = source
    for position in sorted(set(parser.insertions), reverse=True):
        following = source[position:]
        whitespace_match = re.match(r"\s*", following)
        whitespace = whitespace_match.group(0) if whitespace_match else ""
        updated = updated[:position] + whitespace + '<a href="/stay">Stay</a>' + updated[position:]
    return updated, parser.target_count


def process_file(path: Path, *, write: bool = True) -> tuple[bool, int]:
    original_bytes = path.read_bytes()
    source = original_bytes.decode("utf-8")
    updated, target_count = analyze_source(source)
    if updated == source:
        return False, target_count

    if write:
        updated_bytes = updated.encode("utf-8")
        mode = path.stat().st_mode
        temporary_name = ""
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as temporary:
                temporary.write(updated_bytes)
                temporary.flush()
                os.fsync(temporary.fileno())
                temporary_name = temporary.name
            os.chmod(temporary_name, mode)
            os.replace(temporary_name, path)
        finally:
            if temporary_name and os.path.exists(temporary_name):
                os.unlink(temporary_name)
    return True, target_count


def update_file(path: Path, *, write: bool = True) -> bool:
    changed, _target_count = process_file(path, write=write)
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default="public", type=Path)
    parser.add_argument("--check", action="store_true", help="report files that still need the Stay link without modifying them")
    args = parser.parse_args()

    if not args.root.exists() or not args.root.is_dir():
        print(f"error: HTML root is not a directory: {args.root}", file=sys.stderr)
        return 2

    paths = sorted(args.root.rglob("*.html"))
    if not paths:
        print(f"error: no HTML files found under: {args.root}", file=sys.stderr)
        return 2

    changed: list[Path] = []
    target_count = 0
    for path in paths:
        file_changed, file_targets = process_file(path, write=not args.check)
        target_count += file_targets
        if file_changed:
            changed.append(path)

    if target_count == 0:
        print(f"error: no Visit First Monday map-menu targets found under: {args.root}", file=sys.stderr)
        return 2

    for path in changed:
        print(path)

    if args.check:
        print(f"{len(changed)} file(s) need the Stay menu link")
        return 1 if changed else 0

    print(f"Updated {len(changed)} file(s) across {target_count} menu target(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
