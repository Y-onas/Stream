> Historical frontend design notes. Module 4.1 now provides real accounts, membership packages/history, qualified views and rankings; see [current implementation](module41.md). Device storage and format filters remain hidden. Earlier Coming soon states below describe that earlier stage.

# Habeshan HUB incremental frontend refinement

Current profile revision: the previous Device storage panel and Coming soon rows are preserved in `Me.jsx` behind `showLegacyProfile=false`, so they are not rendered or queried. `ProfileDesign.jsx` implements the reference-style hero, local profile editor, working Watchlist/Liked/Membership navigation and support-card interaction. Liked and Membership have frontend views with honest missing-data states. Message support opens a contact dialog; it does not invent or open a Telegram destination. Editing a display name/username saves only on this device. Existing streaming, cache engine, catalogue and saved-video logic are unchanged.

Latest additions: Profile now displays Liked, Membership and Contact Support as unavailable, Coming soon entries, without statistics, dates, routes or Telegram links. Existing Watchlist and device-storage controls are retained. The original format-chip code and styling are preserved behind a false visibility flag in the catalogue and development gallery; no chips are rendered and the catalogue continues using its default all-formats selection. Search and sorting remain functional. All 14 existing regression tests and both frontend builds passed after these additions; the rendered Profile, Search and Watchlist were checked in the browser.

This change reuses the existing React components, styles, routes and local data. No backend, API contract, environment, dependency, Go streaming or storage-schema change was made.

## Changes

- `apps/web/src/layouts/Shell.jsx`: Habeshan HUB wordmark; Home, Search, Premium and Profile navigation; compact desktop/mobile headers. Search keeps the existing `/browse` route.
- `apps/web/src/components/VideoCard.jsx`: original Save and Watch behavior retained; tooltips added; standalone year badges removed; product branding updated for missing artwork.
- `apps/web/src/components/WatchDownloadButton.jsx`: reusable circular download entry with an explicitly unavailable state. A future `onRequest(video)` callback can connect Telegram delivery. It does not open a bot, download bytes or show success.
- `apps/web/src/pages/Catalogue.jsx`: Search/Watchlist labels; existing format filters retained there; Trending directly follows the homepage header. Existing real sorting and unavailable activity states are preserved.
- `apps/web/src/pages/Me.jsx`: Watchlist entry under Your Habeshan HUB; storage controls retained.
- `apps/web/src/pages/Video.jsx`: wording change from Browse to Search; original player and progress implementation retained.
- `apps/web/src/main.jsx`: removed the copied Circles placeholder; Premium still explains its unavailable status.
- `apps/web/src/styles/main.css`: targeted header, spacing, empty-state, action-feedback and responsive refinements using the existing CSS animation system.
- Public/admin HTML and admin wordmark, plus development-only QA page labels, now use Habeshan HUB.

Internal npm workspace names, localStorage keys and IndexedDB names remain compatible with existing installations; these are not displayed as product branding. Existing video titles and filenames remain real source data, including any year already embedded in a filename-derived title. No movie rating, release-year field, actor, genre or review system was introduced.

## Verification

- All 14 existing Node regression tests passed (range/cache behavior, sorting and adapter controls).
- Public and admin production builds passed independently through the root build command.
- Real rendered UI inspected at 375 × 812 and 1440 × 900. No horizontal document overflow was observed. Header, gold active states, card overlays and mobile bottom navigation were checked against the supplied references.
- Existing selected video appeared with its original artwork and metadata. Save was toggled off and on, then the video was confirmed in Profile → Watchlist; the original saved state was restored.
- Search for a missing video produced the correct empty state. The original streaming route returned HTTP 206 with Content-Length 1024 and the correct Content-Range for bytes 0–1023.
- The available MKV/HEVC test video remains subject to the previously documented browser codec limitation. Range delivery is verified; full video decoding was not newly established by this design-only change.

The current catalogue has one real selected video. Trending and Most Viewed await actual backend view statistics; their unavailable states remain visible. Screenshots therefore cannot reproduce the reference's populated movie rankings without fabricating content. Telegram bot delivery, premium purchasing and accounts remain future integrations.

Verification images are stored locally in ignored `.local/habeshan-mobile.png` and `.local/habeshan-desktop.png`.
