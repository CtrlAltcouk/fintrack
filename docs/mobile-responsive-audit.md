# Mobile responsive baseline audit

## Scope and architecture

This audit records the pre-redesign state of Outflow. It intentionally does not
change financial calculations, routes, API contracts, database schema, page
design, or desktop behaviour.

- The server is a single Express application (`server.js`) serving static files
  from `public/` and JSON routes from `routes/`.
- SQLite access is synchronous through one `better-sqlite3` connection in
  `db.js`. Development retains `data/fintrack.db`; production now requires an
  external `OUTFLOW_DB_PATH` (with `FINTRACK_DB_PATH` retained as an alias).
- The frontend is one HTML shell (`public/index.html`), one stylesheet
  (`public/style.css`), and a vanilla JavaScript client (`public/app.js`).
- There is no URL router. `navigate(page)` invokes a function from the in-memory
  `pages` object, and that function replaces `#main` with generated HTML.
- Chart.js is loaded from jsDelivr. Dashboard and report charts are created
  after their canvases are inserted.

## Pages and rendering inventory

All application pages are dynamically generated with template strings and
`innerHTML`; there are no separate page HTML files.

| Surface | Layout and controls | Special content | Primary mobile risks |
| --- | --- | --- | --- |
| Login / user picker | Centred 320 px flex box, forms, colour choices | First-run account creation or existing-user password prompt | The box has no explicit mobile max-width or keyboard/visual-viewport handling; colour choices are non-button `div` elements. |
| Dashboard | Header flex row; fixed four-column dashboard grid; stat grids | Two Chart.js canvases; seven-column calendar; draggable/resizable widgets | Header and mode toggle can crowd; four-column grid compresses widget content; charts, calendar event text, legends, and pointer-only editing need targeted mobile treatment. |
| Accounts | Header flex row; stat grid; add/edit form | Deactivation confirmation modal | Header controls can crowd; inline minimum widths and non-semantic colour swatches; edit action row may wrap awkwardly. |
| Transfers | Wrapping form; flex list rows | History | From/to controls and arrow stack oddly; history rows contain many fixed-order fields and can overflow or make tiny targets. |
| Daily Spending | Header flex row; filter; account chips; form; grouped flex lists | Inline transaction editor | Header filter, amount/date widths, transaction metadata, amount, Edit/Delete controls compete for width; software keyboard may obscure lower form controls. |
| Bills | Month navigation; form; flex lists | Paid-state badges; prompt; cancellation modal | Dense bill rows (name, amount, badge, two actions) are the strongest overflow/touch risk; form keyboard progression and modal reachability need coverage. |
| Income | Mode toggle; forms; stat card; flex lists | Recurring schedule editor generated inline | Numerous fixed/minimum widths; edit rows are injected as a wide flex row; date/number keyboards can cover actions. |
| Reports | Month navigation; cards | Chart.js canvas; ranking list; comparison table | Canvas legend density and the full-width comparison table can become illegible; table has no dedicated scroll wrapper. |
| Settings | Horizontally scrollable tabs; forms and cards | Category editor; personalization; avatar upload; users; backup/restore/system/destructive modals | Many inline layouts and small colour swatches; long tab strip; file/colour inputs; system text/actions and confirmation fields may be hard to reach with the keyboard open. |
| Mobile More sheet | Fixed bottom sheet with flex navigation | Modal semantics, close button, user switch | Focus is trapped and Escape works, but focus is not made inert outside the sheet and prior focus is always returned to More. Screen-reader announcement should be checked manually. |

### Feature locations

- Horizontal flex layouts: every page, the desktop sidebar, mobile navigation,
  list rows, headers, forms, tabs, modal actions, and calendar/header legends.
- Grids: dashboard widget grid, statistic grids, and dashboard calendar.
- Tables: Reports month-comparison only.
- Charts: Dashboard bar/doughnut charts and Reports category chart.
- Calendars: Dashboard calendar only, rendered with injected markup and styles.
- Modals: account deactivation, bill cancellation, destructive settings actions,
  plus browser `prompt`/`confirm`/`alert` for some existing flows.
- Forms: login, accounts, transfers, spending, bills, income and schedules,
  categories, users, password, personalization, avatar, and restore/clear-data.
- Inline styles and dynamic HTML: extensive throughout `public/app.js`; calendar
  CSS is also inserted dynamically. These declarations can outrank later
  responsive rules and make systematic responsive changes fragile.

## Navigation and scrolling

At widths above 768 px, the 220 px sidebar is visible and contains all eight
page links. At widths up to and including 768 px, the sidebar is hidden and a
fixed 60 px bottom bar exposes Dashboard, Spending, Bills, Income, and More.
More opens a bottom sheet for Accounts, Transfers, Reports, and Settings.

`body` is fixed to the viewport and has `overflow: hidden`. `#main` is therefore
the only normal content scroller (`overflow-y: auto`). On mobile it receives
16 px side padding and bottom padding of 80 px plus the safe-area inset. The
sheet has its own capped vertical scroller. This nested model is deliberate,
but creates risks around:

- software keyboards changing the visual viewport while `body` remains fixed;
- focus scrolling inside `#main`, especially for date/number inputs near the end;
- fixed bottom navigation covering dynamically appended editors;
- scroll position being retained when one page replaces another;
- document-level overflow being hidden rather than obviously visible.

## Existing responsive implementation

There is one breakpoint: `@media (max-width: 768px)`. It uses `100dvh`, hides the
sidebar, shows the bottom navigation/sheet, stacks `.form-row`, and makes
`.tabs-nav` horizontally scrollable. It includes safe-area padding and a
`prefers-reduced-motion` override for sheet transitions.

There are no page-specific mobile rules for dashboard widgets, list rows,
charts, tables, calendar cells, page headers, modal vertical overflow, or
software-keyboard states. Desktop styles are otherwise shared unchanged.

## Accessibility baseline

Existing positives include native buttons/inputs for primary actions, a labelled
mobile nav, `aria-expanded`/`aria-controls` on More, dialog attributes and
`aria-hidden` state on the sheet, Escape-to-close, a basic Tab loop, a labelled
close control, decorative SVG/icon hiding, 44 px minimum bottom-nav targets, and
reduced-motion handling.

Concerns to address in later work:

- desktop navigation uses anchor elements without `href`;
- most page changes and asynchronous errors have no live-region announcement;
- active navigation is visual only (`aria-current` is absent);
- several colour/avatar choices are clickable `div` elements and are not
  keyboard controls;
- dynamically created confirmation modals lack dialog labelling, focus
  placement/trapping/restoration, and vertical overflow protection;
- browser `alert`, `confirm`, and `prompt` provide inconsistent flows;
- some icon-only or abbreviated controls rely on surrounding visual context;
- calendar layout is visual rather than a labelled grid/table;
- custom colours may not meet contrast requirements;
- no automated accessibility tooling is currently configured.

## Test and tooling baseline

Before this work, nine standalone Node/assert files existed under `tests/`, but
`package.json` exposed no test scripts. They cover authentication helpers,
date-range parsing, bill due dates, pay periods, dashboard settings migration,
theme parsing, calendar bounds, and database migration. They are not a browser
suite and previously allowed `db-migration.test.js` to open the default
production-path database.

The standard commands are now:

- `npm test` and `npm run test:unit`: run all nine Node tests, each with its own
  temporary SQLite path, then remove the temporary directory.
- `npm run test:e2e`: run Playwright against an isolated temporary SQLite
  database at 320×568, 390×844, 430×932, 768×1024, and desktop 1280×800.
- `npm run check`: run unit tests followed by Playwright.

Playwright is the first screenshot/DOM/browser/E2E tooling in the repository.
Failure screenshots, traces, reports, runtime data, and temporary data are
ignored. The browser fixture substitutes the external Chart.js download with a
minimal local stub so tests are deterministic and do not require CDN access.

## Known risks intentionally not redesigned

Static inspection and baseline automation identify these likely follow-up
issues; this phase does not apply broad CSS to resolve them:

1. Dashboard uses an inline four-column grid at every width. Widget spans,
   chart legends, and calendar event text may be cramped even without
   document-level overflow.
2. Bills, spending, income, and transfer list rows do not have mobile-specific
   stacking. Dense or unusually long user data is more likely to overflow than
   the empty deterministic fixture.
3. Reports has a table without a responsive wrapper, and charts/calendars have
   no narrow-screen presentation rules.
4. Page headers and warning banners use horizontal `space-between` layouts and
   may crowd at 320 px.
5. Inline fixed/minimum widths remain common. `.form-row` stacking prevents the
   main forms from overflowing in the baseline fixture, but dynamically
   injected editors need data-rich tests.
6. Modal width is capped, but modal height is not; a software keyboard or a
   future longer dialog could make actions unreachable.
7. Touch targets outside the bottom nav are often only 28–35 px high, especially
   small buttons, month arrows, tabs, swatches, and calendar navigation.
8. Browser emulation does not reproduce iOS Safari safe-area, address-bar,
   virtual-keyboard, or touch-event behaviour. Physical-device verification is
   still required.

## Recommended implementation order

1. Preserve these shell tests and add representative long/dense fixture data.
2. Establish shared mobile primitives for page headers, action rows, list rows,
   scroll containers, touch targets, and modal height/keyboard handling.
3. Adapt Dashboard grid, charts, and calendar with explicit widget-level rules.
4. Adapt the form/list pages in risk order: Bills, Daily Spending, Income,
   Transfers, Accounts.
5. Add a responsive Reports table/chart treatment, then Settings tab/editor
   refinements.
6. Add automated accessibility checks and manual iOS/Android keyboard and
   assistive-technology passes.

## Guardrails for the mobile implementation

Do not change calculations, schema/migrations, API formats, authentication
contracts, routes, application/package/database names, vanilla JavaScript
architecture, feature set, or desktop appearance. Avoid rewriting dynamic page
rendering during responsive work. Responsive changes should be incremental,
scoped below the existing breakpoint where possible, tested against data-rich
fixtures, and reviewed independently from business-logic changes.
