# Admin dashboard design transfer

The administration application now owns copies of the supplied dashboard's
design implementation. The public video website and the administration API
remain separate applications. No database schema or migration changed for this
transfer.

## Copied implementation

| Supplied reference | Owned implementation | Integration |
| --- | --- | --- |
| `src/index.css` | `apps/admin/src/design/reference.css` | Original tokens, Tailwind layers, glass surfaces, scrollbars and transitions. |
| `tailwind.config.js`, `postcss.config.js` | Same filenames in `apps/admin` | Original theme; content scanning restricted to the admin's own files. |
| `components/AtmosphericBackground.jsx` | `src/design/AtmosphericBackground.jsx` | Original inline SVG and atmospheric modes. No external image dependency. |
| `components/Sidebar.jsx` | `src/design/Sidebar.jsx` | Original layout, dimensions, classes, collapse controls and active states. Uses Hub routes and the authenticated administrator. |
| `components/Topbar.jsx` | `src/design/Topbar.jsx` | Original header and control styling. Actions open Hub navigation search, audit logs and memberships. |
| `components/modals/SearchModal.jsx` | `src/design/NavigationSearch.jsx` | Original search card and result styling. Searches permitted Hub pages; uses a native modal dialog with focus restoration. |
| `components/common/AnimatedCounter.jsx` | `src/design/AnimatedCounter.jsx` | Original counter animation; respects reduced motion. Hub counts render as integers. |
| `App.jsx` | `src/design/DashboardFrame.jsx` | Original sidebar/header/scrolling workspace composition; existing Hub pages and security notice remain children. |
| `components/pages/RevenuePage.jsx` | `src/design/SeriesChart.jsx` | Copied spline construction, SVG geometry, gradients and hover columns, connected to actual analytics fields. Keyboard inspection and the existing reporting table remain available. |
| Content, Settings and modal components | `src/AdminUI.jsx`, `src/styles/main.css` | Copied utility recipes and style values applied to the existing table, search, editor, fields, checkboxes and actions. Existing callbacks and form payloads are retained. |

`src/` in the owned implementation column is relative to `apps/admin`.
These source paths describe provenance; none is a production import from the
temporary reference directory.

Inter and Plus Jakarta Sans are bundled locally in `src/design/fonts`, with
their OFL licenses. `fonts.css` supplies all reference Unicode subsets. Lucide
supplies the copied icon language. Reference photos, mock identities, business
data, endpoints and showcase functionality were not imported.

## Existing behavior retained

`Module42.jsx` still controls Clerk sign-in, backend administrator approval,
identity refresh, owner-only routes, token-bearing API requests and sign-out.
`Management.jsx`, `Settings.jsx`, `PlaybackSessions.jsx` and `Operations.jsx`
retain their existing data loading, validation, confirmations, version fields,
operation keys and mutations. Analytics retains its ranges, metrics, VIP/Free
separation, tables and endpoints; only its presentation changed.

All thirteen authenticated pages share the transferred frame and controls.
The sign-in, setup, verification and access-error views use the same surface,
font and control tokens. The sidebar stays 250px expanded and 72px collapsed.
On phones it starts collapsed and expands over a scrim; large tables scroll
inside their cards. Header labels collapse when the available width requires
it. Native form dialogs preserve focus handling, busy states and validation.

## Verification

- Compared a rendered copy of the original reference with the migrated UI.
- Inspected all 13 authenticated pages at 1440px and 390px; also checked 320px
  and 768px layouts. Page content remained within the viewport, with wide
  tables scrolling inside their containers.
- Checked sidebar collapse/drawer navigation, role-filtered menus and search,
  keyboard search/Enter/Escape, refresh, and mobile editor layout.
- Exercised video edit, platform settings and exact-username manual membership
  forms with isolated fixture responses; verified their original payload fields.
  No live account, membership, approval or setting was changed.
- Existing Node suite: 130 passed, 15 opt-in integration/browser tests skipped;
  no failures. Added a separate passing regression test for both sidebar render
  branches and supplied-route isolation (`tests/admin-design.test.mjs`).
- Both frontend production builds passed. An additional staged admin production
  build contained no reference directory and verified that no source module
  escaped the staged tree or imported the temporary reference. Local font files
  were emitted with the production assets.
- SHA-256 checks confirmed all 33 original reference files remained unchanged.
  Source searches found no imports or asset URLs pointing to that directory.
  The temporary reference is excluded from Git and Docker build contexts.

Screenshots and the isolated preview/build harnesses are under ignored
`.local/qa`. They are verification artifacts, never production routes or an
authentication bypass. Fixtures are not shipped in the application. The
existing authenticated Google flow was not repeated with a personal account;
its access and routing tests passed. Database/browser integration tests remain
opt-in and were not enabled for this presentation-only change. Nothing was
deployed.

## Runtime stylesheet correction

The first migration's fixture preview supplied its own explicit PostCSS
pipeline. The already-running real admin Vite server did not pick up the new
stylesheet configuration and served raw `@tailwind` directives, leaving the
backdrop visible while the dashboard layout utilities were missing.

The admin Vite configuration now imports its own PostCSS pipeline explicitly.
That pipeline resolves the admin Tailwind theme from its configuration file's
location, independent of the command's working directory. This also makes the
configuration a watched Vite dependency.

Verification now exercises the real Vite configuration from the repository
root and checks that layout utilities compile and raw directives are absent.
The actual running server was checked before and after the fix. Navigation
and real database-backed views were inspected in the user's signed-in Chrome
session without submitting administrative changes. The source reference is
still unchanged; no new visual design was introduced for this correction.

After this correction: 147 tests, 132 passed, 15 opt-in tests skipped, zero
failures. The admin production build and the staged build without the
temporary reference both passed.

## Analytics readability refinement

Analytics now starts with four compact summaries and the reference's underline
tabs: Viewing, Audience, Memberships and Catalogue. Three-card grids, ranking
bars and the reference palette replace the twenty competing metric tiles.
Current totals, selected-period activity and calendar totals are labelled
separately. The overview uses the same compact cards; its full platform totals
remain in an expandable report.

Every original metric, six time series, video/duration rankings, trending
periods, package distribution, request conversion and detailed reporting table
remain available. Ranking previews show five entries with their full tables
below. No demographic, device, location or comparison data was fabricated.
API queries, date presets, custom bounds, timezone and backend calculations
are unchanged. Charts have a bounded height, readable labels and arrow-key
inspection; tabs support arrow keys, Home and End.

Verified all four sections at desktop and phone widths, 320px overflow,
custom-date query parameters, keyboard tabs/charts, expanded reports and empty
data. The regression suite checks that source metric and series values survive
the presentation change. Result: 133 passed, 15 opt-in tests skipped. Both
frontend production builds passed. The temporary reference folder had already
been moved out of the repository and was not needed by either build.
