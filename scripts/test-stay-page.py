#!/usr/bin/env python3
"""Static behavioral checks for the Visit First Monday Stay page."""

from __future__ import annotations

import html.parser
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "public" / "stay.html"
VERCEL = ROOT / "vercel.json"
SITEMAP = ROOT / "public" / "sitemap.xml"
LLMS = ROOT / "public" / "llms.txt"
CANONICAL = "https://www.visitfirstmonday.com/stay"
HOTEL_URL = "https://www.visitcantontx.com/stay"
RV_BOOKING_URL = "https://www.e-marketmanager.net/webrentalFirstMondayTd/Contents/LayoutIndex.aspx?FleaMarketID=6628374051"
RV_MAP_URL = "https://www.firstmondaycanton.com/_files/ugd/0b9bd5_52e039d6a3e5436b92c7c85b70f1cb52.pdf"
HERO_IMAGE_URL = "https://statics.myclickfunnels.com/workspace/eOQKpZ/image/10541981/file/40957c5ee88b2b879b815abfd151b3b2.jpg"
HOTEL_SOURCE_URL = "https://cantontxfirstmonday.com/first-monday-trade-days-hotels.htm"
RV_SOURCE_URL = "https://cantontxfirstmonday.com/first-monday-trade-days-rv-parks.htm"
APPROVED_IMAGE_URLS = {
    "https://statics.myclickfunnels.com/workspace/eOQKpZ/image/15189067/file/931702d11ab922f606c918993fa3f790.png",
    "https://statics.myclickfunnels.com/workspace/eOQKpZ/image/15872527/file/3ddf6e709dd2be91167e8afb794025e9.png",
    "https://statics.myclickfunnels.com/workspace/eOQKpZ/image/13558040/file/977106dac8923699b28e1c56e2fa25f0.jpg",
    HERO_IMAGE_URL,
}
APPROVED_IMAGE_DIMENSIONS = {HERO_IMAGE_URL: (5200, 3466)}
REQUIRED_PLANNING_LINKS = {
    "https://www.visitfirstmonday.com/dates-first-monday",
    "https://www.visitfirstmonday.com/first-monday-trade-days-map",
    "https://www.visitfirstmonday.com/lewis-first-monday-parking",
    "https://www.visitfirstmonday.com/first-monday-first-timer-guide",
}


class StayParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, dict[str, str]]] = []
        self.images: list[dict[str, str]] = []
        self.buttons: list[dict[str, str]] = []
        self.scripts: list[tuple[dict[str, str], str]] = []
        self._script_attrs: dict[str, str] | None = None
        self._script_parts: list[str] = []
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if tag == "a":
            self.links.append((values.get("href", ""), values))
        elif tag == "img":
            self.images.append(values)
        elif tag == "button":
            self.buttons.append(values)
        elif tag == "script":
            self._script_attrs = values
            self._script_parts = []

    def handle_data(self, data: str) -> None:
        if self._script_attrs is not None:
            self._script_parts.append(data)
        else:
            self.text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._script_attrs is not None:
            self.scripts.append((self._script_attrs, "".join(self._script_parts)))
            self._script_attrs = None
            self._script_parts = []


def require(condition: bool, message: str, failures: list[str]) -> None:
    if not condition:
        failures.append(message)


def relative_luminance(color: str) -> float:
    channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    linear = [channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast_ratio(foreground: str, background: str) -> float:
    lighter, darker = sorted((relative_luminance(foreground), relative_luminance(background)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def jsonld_types(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        item_type = value.get("@type")
        if isinstance(item_type, str):
            found.add(item_type)
        elif isinstance(item_type, list):
            found.update(item for item in item_type if isinstance(item, str))
        for child in value.values():
            found.update(jsonld_types(child))
    elif isinstance(value, list):
        for child in value:
            found.update(jsonld_types(child))
    return found


def main() -> int:
    failures: list[str] = []
    require(PAGE.exists(), "public/stay.html must exist", failures)
    if not PAGE.exists():
        print("STAY PAGE TESTS: FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1

    source = PAGE.read_text(encoding="utf-8")
    parser = StayParser()
    parser.feed(source)
    visible = " ".join(" ".join(parser.text_parts).split())
    visible_phone_normalized = visible.replace("‑", "-")
    hrefs = {href for href, _attrs in parser.links}

    config = json.loads(VERCEL.read_text(encoding="utf-8"))
    rewrites = config.get("rewrites", [])
    require(
        any(rule.get("source") == "/stay" and rule.get("destination") == "/stay.html" for rule in rewrites),
        "vercel.json must rewrite /stay to /stay.html",
        failures,
    )

    canonical_pattern = re.compile(
        r'<link\b(?=[^>]*\brel=["\']canonical["\'])(?=[^>]*\bhref=["\']https://www\.visitfirstmonday\.com/stay["\'])[^>]*>',
        re.I,
    )
    require(bool(canonical_pattern.search(source)), "canonical URL must be the production /stay URL", failures)
    require("Hotels & Lodging" in visible, "Hotels & Lodging section must be visible", failures)
    require("RV Camping" in visible, "RV Camping section must be visible", failures)
    require(HOTEL_URL in hrefs, "Visit Canton lodging CTA must use the approved URL", failures)
    require(RV_BOOKING_URL in hrefs, "official First Monday RV booking link must be present", failures)
    require(RV_MAP_URL in hrefs, "official RV park PDF map link must be present", failures)
    require({HOTEL_SOURCE_URL, RV_SOURCE_URL} <= hrefs, "independent Canton lodging and RV source links must be present", failures)
    require(
        all(name in visible for name in ("Quality Inn & Suites", "Days Inn & Suites by Wyndham Canton", "Super 8 by Wyndham Canton")),
        "Canton hotel starting points must be visible",
        failures,
    )
    require(all(name in visible for name in ("Canton Marketplace RV Park", "The Silver Spur Resort", "Rolling Oaks RV Park", "Bluebird RV Park", "Texas Log Cabin RV Park", "Sumner RV Park")), "curated RV comparison options must be visible", failures)
    require(
        any(href == "tel:903-567-6556" for href in hrefs) and "903-567-6556" in visible_phone_normalized,
        "full-hookup phone number must be visible and use a tel: link",
        failures,
    )
    require(REQUIRED_PLANNING_LINKS <= hrefs, "dates, map, parking, and first-timer production links must all be present", failures)

    require(any(button.get("id") == "menu-toggle" and button.get("aria-expanded") == "false" and button.get("aria-controls") == "mobile-nav" for button in parser.buttons), "mobile menu button must expose aria-expanded and aria-controls", failures)
    require('id="mobile-nav"' in source and 'aria-label="Mobile"' in source, "mobile navigation must be labelled", failures)
    require("min-height: 44px" in source or "min-height:44px" in source, "actionable controls must have a 44px minimum target size", failures)
    require("max-height: calc(100dvh - 78px)" in source and "overflow-y: auto" in source, "mobile navigation must scroll within short viewports", failures)
    require(":focus-visible" in source, "keyboard focus styles must be present", failures)
    require("prefers-reduced-motion" in source, "reduced-motion preference must be respected", failures)
    require(contrast_ratio("#08271f", "#149d61") >= 4.5 and contrast_ratio("#08271f", "#1bc879") >= 4.5, "primary CTA text must meet WCAG AA contrast across its gradient", failures)
    require(all(contrast_ratio("#7d3a22", background) >= 4.5 for background in ("#f5efe2", "#fffaf0", "#ecdfc6")), "small rust labels must meet WCAG AA contrast on their backgrounds", failures)

    parsed_jsonld: list[object] = []
    for attrs, body in parser.scripts:
        if attrs.get("type") == "application/ld+json":
            try:
                parsed_jsonld.append(json.loads(body))
            except json.JSONDecodeError as exc:
                failures.append(f"JSON-LD must parse: {exc}")
    types = jsonld_types(parsed_jsonld)
    require({"WebPage", "BreadcrumbList", "FAQPage"} <= types, "JSON-LD must include WebPage, BreadcrumbList, and FAQPage", failures)

    required_questions = {
        "When should I book for First Monday?",
        "Can I stay in an RV near the market?",
        "Where can I compare hotels and other lodging?",
        "What days is the market open?",
    }
    require(required_questions <= set(re.findall(r"<h3[^>]*>(.*?)</h3>", source, re.S)), "all four required FAQ questions must be visible", failures)
    require("Thursday–Sunday before the first Monday" in visible or "Thursday through Sunday before the first Monday" in visible, "visible schedule must say Thursday–Sunday before the first Monday", failures)
    forbidden_monday_claims = ("open Monday", "opens Monday", "runs Monday", "held Monday")
    require(not any(claim.lower() in visible.lower() for claim in forbidden_monday_claims), "page must not state that the market is open Monday", failures)
    require("book early" in visible.lower(), "page must advise visitors to book early", failures)
    require("independent shopper guide" in visible.lower(), "independent-guide disclosure must be visible", failures)
    require("rates" in visible.lower() and "availability" in visible.lower() and "lodging providers" in visible.lower(), "provider rates/availability/booking disclosure must be visible", failures)

    approved_images = set(APPROVED_IMAGE_URLS)
    homepage = ROOT / "public" / "vfm-homepage.html"
    if homepage.exists():
        approved_images.update(
            re.findall(
                r'https://statics\.myclickfunnels\.com/[^"\')\s]+',
                homepage.read_text(encoding="utf-8"),
            )
        )
    page_images = set(re.findall(r'https://statics\.myclickfunnels\.com/[^"\')\s]+', source))
    require(bool(page_images), "page must use approved current imagery", failures)
    require(page_images <= approved_images, "all branded image URLs must be in the approved Visit First Monday image allowlist", failures)
    require(all(image.get("alt", "").strip() for image in parser.images), "all img elements must have alt text", failures)
    require(source.count(HERO_IMAGE_URL) >= 4, "approved high-resolution hero image must power hero, social cards, and structured data", failures)
    hero_width, hero_height = APPROVED_IMAGE_DIMENSIONS[HERO_IMAGE_URL]
    require(hero_width >= 1200 and hero_height >= 630 and hero_width / hero_height >= 1.4, "hero/social image must be high-resolution and landscape-oriented", failures)
    require(source.count("Two shoppers smiling beside clothing racks at First Monday Trade Days") == 2, "social image alt metadata must accurately describe the approved photo", failures)

    sitemap = ET.parse(SITEMAP)
    locs = {node.text for node in sitemap.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc")}
    require(CANONICAL in locs, "sitemap must include the canonical /stay URL", failures)
    require(CANONICAL in LLMS.read_text(encoding="utf-8"), "llms.txt must list the Stay page", failures)

    external_hrefs = [href for href in hrefs if href.startswith(("http://", "https://"))]
    require(all(urlparse(href).scheme == "https" and urlparse(href).netloc for href in external_hrefs), "external links must be absolute HTTPS URLs", failures)
    require(not any(href.startswith("/") and href != "/stay" for href in hrefs), "preview-safe navigation must use production Visit First Monday URLs", failures)

    if failures:
        print("STAY PAGE TESTS: FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("STAY PAGE TESTS: PASS")
    print("- stay.html exists and required content/links are present")
    print("- /stay rewrite, canonical, sitemap, and llms.txt are valid")
    print("- navigation, 44px controls, focus, and reduced motion checks pass")
    print("- WebPage, BreadcrumbList, and FAQPage JSON-LD parse successfully")
    print("- schedule language, approved imagery, and provider disclosures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
