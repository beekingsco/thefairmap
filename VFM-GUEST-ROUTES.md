# Visit First Monday guest routes

`visitfirstmonday.com` and `thefairmap.com` share Vercel project `thefairmap` (`outputDirectory: public`). They must not share the same homepage.

| Host / path | Serves |
| --- | --- |
| `thefairmap.com/` | Fair Map product marketing (`public/marketing.html`) |
| `visitfirstmonday.com/` | VFM guest homepage (`public/vfm-home.html`) |
| `visitfirstmonday.com/app-download` | VFM download landing (`public/app-download.html`) |
| `visitfirstmonday.com/vendor-listing-info` | 302 → `https://vfm.buzzonmarketing.com/vendors` |
| `/first-monday-finder`, `/map.html`, `/embed`, `/api/locations` | Shopper map (do not break) |
| `/location/<id>` (any host on this project) | Shopper map (`public/map.html`). Vendor share links from `shareLocation()` use `${origin}/location/${locId}`. |

Store links on `/app-download`:

- App Store: https://apps.apple.com/us/app/visit-first-monday/id6746057595
- Google Play: https://play.google.com/store/apps/details?id=com.TnCzkYTWJRzX.natively

Vendor signup must be the VFM portal (`https://vfm.buzzonmarketing.com/vendors`), never `thefairmap.com/signup`. `map.thefairmap.com/vendor-login` exists but is the Fair Map password login, not the working VFM guest/vendor portal.

## LINKS + DEALS — in this repo vs Natively

In-repo buttons live in `public/map.html` (LINKS tab):

- Vendor Map Listing Signup → `https://vfm.buzzonmarketing.com/vendors`
- Download the App → `https://visitfirstmonday.com/app-download`

`/first-monday-finder` is a locked app-entry webview wrapper. If the store app loads that wrapper or `map.html` as a WebView, these in-repo hrefs are what guests tap.

This repo has **no Natively project** (no `natively.json`, no iOS/Android app source). The published app package `com.TnCzkYTWJRzX.natively` is built on Natively. Any **native** LINKS / DEALS buttons configured in the Natively builder are outside this git repo and will not change when this Vercel project deploys. Check the Natively dashboard if a store-app build still opens Fair Map marketing after this web fix.

## Deploy

Do not promote stub commit `220166d` (only seeded `pub/full-export.json`). After promote, confirm shopper routes still 200 and that `visitfirstmonday.com/app-download` is VFM guest copy, not “Get Your Map”.
