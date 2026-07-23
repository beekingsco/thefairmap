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
ASCII_WHITESPACE_RE = re.compile(r"[\t\n\f\r ]+")


class MenuHeaderParser(HTMLParser):
    """Collect safe menu insertion offsets while validating relevant structure."""

    def __init__(self, source: str) -> None:
        super().__init__(convert_charrefs=False)
        self.source = source
        self.line_offsets = [0]
        for match in re.finditer(r"\n", source):
            self.line_offsets.append(match.end())
        self.header_stack: list[dict[str, Any]] = []
        self.anchor_stack: list[tuple[dict[str, Any], dict[str, Any]]] = []
        self.insertions: list[int] = []
        self.target_count = 0
        self.errors: list[str] = []
        self.saw_site_header = False

    def source_index(self) -> int:
        line, column = self.getpos()
        return self.line_offsets[line - 1] + column

    def active_site_header(self) -> dict[str, Any] | None:
        for header in reversed(self.header_stack):
            if header["site"]:
                return header
        return None

    @staticmethod
    def is_site_header(attrs: list[tuple[str, str | None]]) -> bool:
        classes = next((value or "" for name, value in attrs if name.lower() == "class"), "")
        return "site-header" in ASCII_WHITESPACE_RE.split(classes.strip())

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "header":
            is_site = self.is_site_header(attrs)
            if is_site:
                self.saw_site_header = True
            if (is_site and self.header_stack) or self.active_site_header() is not None:
                self.errors.append("nested header intersects a site-header")
            if self.anchor_stack:
                self.errors.append("header opened before a site-header anchor closed")
            self.header_stack.append({"site": is_site, "anchors": []})
            return

        if tag != "a":
            return
        header = self.active_site_header()
        if header is None:
            return
        if self.anchor_stack:
            self.errors.append("nested anchor inside a site-header")
        href = next((value or "" for name, value in attrs if name.lower() == "href"), "")
        anchor = {"href": href, "end": None}
        header["anchors"].append(anchor)
        self.anchor_stack.append((header, anchor))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "header" and (self.is_site_header(attrs) or self.active_site_header() is not None):
            self.errors.append("self-closing header intersects a site-header")
        elif tag == "a" and self.active_site_header() is not None:
            self.errors.append("self-closing anchor inside a site-header")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "a":
            if not self.anchor_stack:
                if self.active_site_header() is not None:
                    self.errors.append("closing anchor without a matching site-header anchor")
                return
            header, anchor = self.anchor_stack.pop()
            if header is not self.active_site_header():
                self.errors.append("site-header anchor closed in a different header")
            start = self.source_index()
            closing = self.source.find(">", start)
            if closing < 0:
                self.errors.append("anchor closing tag is incomplete")
            else:
                anchor["end"] = closing + 1
            return

        if tag != "header":
            return
        if not self.header_stack:
            if self.saw_site_header:
                self.errors.append("closing header without a matching opening header")
            return
        header = self.header_stack.pop()
        unclosed = [entry for entry in self.anchor_stack if entry[0] is header]
        if unclosed:
            self.errors.append("site-header closed before one of its anchors")
            self.anchor_stack = [entry for entry in self.anchor_stack if entry[0] is not header]
        if header["site"]:
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

    def finish_validation(self) -> None:
        if any(header["site"] for header in self.header_stack):
            self.errors.append("site-header is not closed")
        if self.anchor_stack:
            self.errors.append("site-header anchor is not closed")


def analyze_source(source: str) -> tuple[str, int]:
    parser = MenuHeaderParser(source)
    parser.feed(source)
    parser.close()
    parser.finish_validation()
    if parser.errors:
        unique_errors = list(dict.fromkeys(parser.errors))
        raise ValueError("malformed menu HTML: " + "; ".join(unique_errors))

    updated = source
    for position in sorted(set(parser.insertions), reverse=True):
        following = source[position:]
        whitespace_match = re.match(r"\s*", following)
        whitespace = whitespace_match.group(0) if whitespace_match else ""
        updated = updated[:position] + whitespace + '<a href="/stay">Stay</a>' + updated[position:]
    return updated, parser.target_count


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


def inspect_file(path: Path) -> tuple[bytes, bytes, int]:
    original = path.read_bytes()
    source = original.decode("utf-8")
    updated, target_count = analyze_source(source)
    return original, updated.encode("utf-8"), target_count


def process_file(path: Path, *, write: bool = True) -> tuple[bool, int]:
    original, updated, target_count = inspect_file(path)
    changed = updated != original
    if changed and write:
        write_atomic(path, updated)
    return changed, target_count


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

    plans: list[tuple[Path, bytes, bytes, int]] = []
    errors: list[str] = []
    for path in paths:
        try:
            original, updated, file_targets = inspect_file(path)
            plans.append((path, original, updated, file_targets))
        except (UnicodeDecodeError, ValueError) as exc:
            errors.append(f"{path}: {exc}")

    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        print("error: malformed menu HTML; no files were modified", file=sys.stderr)
        return 2

    target_count = sum(plan[3] for plan in plans)
    if target_count == 0:
        print(f"error: no Visit First Monday map-menu targets found under: {args.root}", file=sys.stderr)
        return 2

    changed = [plan for plan in plans if plan[1] != plan[2]]
    for path, _original, _updated, _targets in changed:
        print(path)

    if args.check:
        print(f"{len(changed)} file(s) need the Stay menu link")
        return 1 if changed else 0

    for path, _original, updated, _targets in changed:
        write_atomic(path, updated)
    print(f"Updated {len(changed)} file(s) across {target_count} menu target(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
