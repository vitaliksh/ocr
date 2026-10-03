# GUI redesign plan — ANNATERIA

**Written:** 3 October 2026. **Status:** agreed with Vitalik. Stage 1 and the lock/reopen task are done (3 Oct); stage 2 is done and awaiting his check (see "Stage 2 as built"). Supersedes the "step 6" notes in
`MIGRATION_HANDOFF.md`.

## Decisions (from the discussion)

- Product name: **ANNATERIA**, Latin script, as a wordmark in the top bar and in `<title>`. UI text stays Hebrew, RTL.
  Name availability (domain, trademark) has not been checked.
- Main product: **clients DB management + reports**. The Rivhit TXT export is deprecated; its code stays for now but
  leaves the main UI (menu "⋯", marked legacy) and must no longer gate anything.
- Style: modern and solid, "Claude Light": warm off-white background, white surfaces, warm grey borders, terracotta
  accent. No dark theme, no phone support (desktop only).
- Terracotta is **only** for the primary button and the active item. Status colours are a separate fixed set
  (success green, warning amber, error cool red, info blue-grey) so an accent is never mistaken for a warning.
  Text on terracotta fills must pass WCAG AA (use about `#C15F3C` or darker, not the light `#D97757`).
- Fonts: Heebo (UI) and Frank Ruhl Libre (headings, wordmark), both OFL, **self-hosted** woff2 in `telegram-web/fonts/`.
- Layout: full-height app shell, only the middle region scrolls. A bottom dock slot is reserved for the future AI
  assistant, but **nothing is rendered there until the assistant exists** (Vitalik: no placeholder text on the front
  page).
- Sidebar: persistent, collapsible to an icon rail, width changeable by dragging, state remembered.
- Table columns: user-selectable (see stage 5). Hidden never means deleted.
- Closing a declaration no longer needs the Rivhit template and creates no export (stage 1).
- New start screen "Clients" and a client card (stage 3).

## Rules for every stage

- One stage = one commit (tests and docs in the same commit), pushed with a bumped frontend marker.
- Existing element ids are never renamed (`app.js`, `test/app-harness.mjs` and other tests query them).
- `app.js` addresses table cells by index (`row.cells[N]`, about 55 places). **Cells are never removed or reordered**;
  columns are hidden with CSS only.
- Old CSS rules of a screen are deleted in the same commit that restyles it. New CSS is written readable (multi-line),
  not minified.
- Real client data from `new examples/` never appears in code, tests, docs or screenshots that get committed.
- Each stage ends with Vitalik checking it in Edge on the published page (the Claude pane cannot pick folders,
  see `MIGRATION_HANDOFF.md`). I can check layout in the pane with the OPFS stub.
- Changes to existing functions are listed in the stage report.

## Stages

### Stage 1 — Decouple from the Rivhit template (behaviour, not visual)

Reason: the top bar cannot be designed around a primary action that still depends on a deprecated file.

- `updateStartAvailability` (`app.js`): `start` and `closeDeclarationButton` no longer require `hasCanonicalTemplate()`;
  the "choose a Rivhit template" requirement text goes away.
- Close handler (`app.js`, `closeDeclarationButton` click): keep the confirm, require at least one active row, save the
  draft, call `finalizeDeclaration` with a marker `finalExport` (new value `"no-export"`, like the existing
  `"excel-import"`), lock the table, append history once. No PDF/TXT, no export folder.
- Confirm text changes ("lock the table and update history").
- The draft-export button keeps working when a template exists; it is moved out of sight in stage 2.
- Tests: close without a template, history appended once, closed table locked.
- Risk: `finalExport` is validated as non-empty only (`declaration-core.js`), so no schema change.

### Stage 2 — Tokens, base components, app shell

- `tokens.css`: colours, type scale, spacing 4/8/12/16/24/32, radii, shadows, focus ring.
- `base.css`: buttons (primary / secondary / quiet / danger), inputs, selects, checkboxes, badges, status plates
  (success, warning, error, info), icons (one inline SVG set instead of emoji).
- Shell (grid, 100dvh): top bar · [sidebar | main] · status bar. The third row is reserved for the AI dock.
  - Top bar: ANNATERIA wordmark, breadcrumb "client › month" (`#current-client`, `#journal-title` content),
    declaration badge (open / closed), the primary action "add documents" (menu: Telegram, PDF, Excel), stop-processing
    button (`#stop-processing`) when active, "⋯" menu (close declaration, legacy Rivhit export).
  - Upload card shrinks into the add-documents menu and a compact status strip; the QR panel opens on demand.
  - `#status` and `#upload-requirements` move into the bottom status bar; same ids.
- `report-viewer.js` inline `STYLE` reads the same tokens (stage 7 restyles it fully).
- Print fallback (`reports.css`, `body>*:not(#report-print)`) must keep working: `#report-print` stays a direct child
  of `body`.
- Fonts added here; the wordmark and `<title>` change here.
- Risk: z-index and positioning of the floating photo window and dialogs inside the new shell.

### Stage 2 as built (3 October)

- Done as planned: `tokens.css`, `base.css`, `shell.css`, `shell.js`, self-hosted fonts, top bar (☰, ANNATERIA wordmark,
  client/month breadcrumb in `#current-client`, open/locked badge `#declaration-badge`, "Reports", "+ Add documents"
  menu with Telegram upload and Excel import, "⋯" menu with lock / reopen / legacy Rivhit export), scrolling
  workspace, status bar (`#upload-requirements`, `#status` with info/error colouring).
- All hard-coded colours of the four old stylesheets were mapped to tokens by a script and the files were
  pretty-printed; rules replaced by the new files (old header, card, buttons, links, journal heading) were deleted.
  The table header, rows and dialogs only changed colour; their structure is restyled in stages 5 and 6.
- Deviations: the Telegram QR panel stays inside the active upload strip (it is needed the moment a session starts)
  instead of opening on demand; `report-viewer.js` keeps its own inline CSS until stage 7 (it is a separate
  document and cannot share `tokens.css` without loading it); the draft-export (TXT) item lives in the "⋯" menu.
- Existing code changed: `app.js` (`updateStartAvailability` sets the badge and hides lock/reopen; `showError` marks
  the status line as an error; two element lookups), `workspace.css` (`#current-client` no longer hidden, dialog
  titles inherit their colour), `package.json` (`check` also syntax-checks `shell.js`).

### Stage 3 as built (3 October)

- Start screen "Clients" (table with name, activity, last declaration, open and locked counts, search, archive switch,
  empty states for "no data root", "no clients", "no match"), client card (activity, business kind, VAT period,
  advance percent, declarations grouped by year as cards with open/locked badge and lazily loaded row counts, new
  declaration, edit client through the existing client dialog), and a clickable breadcrumb
  "Clients › client › month". Opening a declaration shows the journal; top-bar actions for the open declaration
  appear only there.
- Deviations from the plan: client creation, archive and delete still live in the drawer / client dialog (the "+ New
  client" button opens the drawer with the form) until stage 4 replaces the drawer; the client tax ID slot is not shown
  (nothing to store yet); `workspace.js` was only extended, its minified rendering is rewritten in stage 4 together
  with the characterisation tests.
- Existing code changed: `workspace.js` (new optional `onClientsChanged` argument called at the end of
  `renderClients`, four extra returned methods), `app.js` (three calls into `clientsHome`, plus its creation and bind),
  `index.html` (view containers, breadcrumb, `journal-only` classes).

### Stage 3 plan text

— Clients home, client card, navigation model

New views, switched by state (no router needed): **Clients** (start screen), **Client** (card), **Journal**.

- Clients home: table with name, activity, last declaration, number of open declarations, status (active / archived);
  search; "new client" button. Replaces the empty "no client selected" state.
- Client card: details (name, activity, business kind), reporting settings (VAT period, advance percent, from
  `report-settings.json`), declarations list grouped by year (month, open/closed badge, row count loaded lazily so no
  schema change), actions (new declaration, import Excel, reports, archive / delete in the "⋯" menu with confirm).
- A slot for the client tax ID (עוסק מורשה) is left in the layout. **Storing it is a data-model change and a separate
  decision**; until then the PDFs keep showing the name only.
- Data comes from `workspace.js` (`activeClients`, `scanClientsFromRoot`); new module for the view logic, pure parts
  testable.
- Risk: `workspace.js` keeps client-list rendering in one very long line (about 6 KB); the client and declaration
  rendering is rewritten here. Before the rewrite, add characterisation tests in the harness (select client, select
  declaration, archive, delete, new declaration with `keepDrawer`).

### Stage 4 as built (3 October)

- The drawer is gone. `#workspaces-drawer` is now a docked sidebar (the id is kept): header with the data folder
  name, "All clients" navigation item, searchless client list (avatar, name, "⋯" opens the existing client dialog),
  the expanded client's declarations (newest first, open/locked dot, "+ new declaration"), footer with folder
  switcher, "Settings" and the version lines. It collapses to an icon rail with the ☰ button and is resized by dragging
  its inner edge or with the arrow keys (220–420 px); both are remembered in `localStorage`.
- Settings (model, template, classification codes, AI connection) moved into `#settings-dialog`; new clients are
  created in `#new-client-dialog` (errors appear inside it). Ids are unchanged.
- Clicking a client in the sidebar opens its card; clicking a declaration opens the journal. Archive / restore /
  delete of a declaration moved to the cards of the client card (workspace API `setDeclarationArchived`,
  `deleteDeclaration`). A restored data root that needs the browser's permission shows a grant button on the clients
  list (workspace flag `needsPermission`), "All clients" refreshes the list from disk.
- Deviations: the client list has no search yet (the clients view has one), the client row menu is still the old
  client dialog, and the "Reports / Import" items stay in the top bar (they act on the open declaration's client).
- Existing code changed: `workspace.js` (`renderClients` replaced by `sidebar-clients.js`, new optional arguments
  `onClientOpen`, `newClientDialog`, `newClientError`, `needsPermission` flag, extra API methods, removed
  `toggleClient`), `app.js` (drawer functions, listeners and the error mirroring removed; three new arguments),
  `workspace.css` (about 95 obsolete drawer and tree rules deleted), `index.html`.

### Stage 4 plan text

— Sidebar (replaces the drawer)

- Persistent, collapsible, resizable, state in `localStorage` (a pure per-viewer convenience).
- Content: client switcher with search; the active client's declarations (year groups, badges); navigation
  "Clients · Journal · Import · Reports · Settings"; at the bottom the data-folder indicator (name, green dot) and the
  version lines (`גרסת ממשק`, `גרסת שרת`).
- Settings leave the tree and become a **settings dialog**: Gemini model, Rivhit template (legacy, optional),
  classification codes, passkey connection. Ids unchanged (`#model`, `#select-template`, `#manage-classifications`,
  `#register-passkey`, ...).
- Destructive actions only inside "⋯" with confirmation.
- Drawer markup, backdrop and `.drawer-open` handling are removed; `app.js` drawer wiring (`setWorkspacesDrawer`,
  `#open-workspaces-drawer`) is adapted. Ids that tests use stay.

### Stage 5 as built (3 October)

- Spike result: `<col style="visibility: collapse">` works in Chromium but the table then shrinks instead of
  redistributing, so hidden columns are 18 px **stubs** (generated CSS by `nth-child` plus a `+` in the header) and the
  visible columns share the rest by weight in a generated `<colgroup>`.
- Chooser button "עמודות" (with a count of hidden columns) with grouped checkboxes and presets "מינימום" / "הכול", a
  `×` in every non-core header on hover, and a click on a stub restores the column in place. The hidden set is stored in
  `common/ui-settings.json` of the data root; drag-resized widths stay a per-viewer `localStorage` value.
- Default preset: hides supplier ID, allocation number, both recognition percents, agent decision and confidence. The
  "for export" checkbox stays visible because unchecked rows are left out of the reports.
- Partial recognition (VAT or expense below 100 %) is marked with an amber bar and a tooltip on the VAT cell
  (`recalculateRow`), so it stays visible while the percent columns are hidden.
- Toolbar: filter chips with counts (all, needs review, duplicates, outside the reports), search over the visible and
  edited text, and a sticky totals row (gross, net, VAT of the visible included rows) in the same columns.
- Look: dark bold header with an accent underline, quiet inputs that show a border on hover and focus, no vertical
  grid lines, tabular numbers right-aligned.
- Deviations: no sticky first columns (the table fits the width, and a horizontal scroller would break the sticky
  header); no row selection (a click on a row opens the photo, selection waits for the AI assistant); the row delete
  button is only restyled, it still deletes without a confirmation (adding one would change behaviour); validation
  errors do not link to hidden columns because the only validation left is the deprecated Rivhit export.
- Existing code changed: `app.js` (creates the columns and the toolbar, loads the settings on a data-root switch,
  `recalculateRow` sets the partial marker), `index.html` (header keys, `id="journal-table"`, toolbar, totals row),
  `styles.css` (table rules moved to `journal.css`), `shell.css` (spacing moved to the children so the totals row sticks
  flush), `package.json`. Removed: `table-columns.js`, `table-layout.css`.

### Stage 5 after Vitalik's review (3 October)

- Stubs with "+" were dropped (confusing): a hidden column is collapsed completely through its `<col>` and its cells are
  emptied by generated CSS (otherwise zero-width cells wrap letter by letter and make every row tall). The chooser and
  the `×` in the header remain the ways to hide and show columns.
- Width bug fixed: dragged widths were saved in pixels and mixed with the unit-less default weights, which produced
  absurd widths after hiding and showing columns. Weights are now stored in the unit of the defaults, minimum shares
  are enforced, and the storage key changed to `annateria-column-widths-v2`.
- The aligned totals row was replaced by a labelled summary bar (turnover, expenses, output VAT, input VAT, equipment
  VAT when present, payable or refund, counts of rows to review and outside the reports) computed like the VAT report.
- Filter chips became one "סינון" menu with counts; search is a magnifier that opens a field with a "found N of M"
  counter, a clear button and Escape. Rows without a source image (imported from Excel) are not "needs review".
- The data folder (name and change button) moved from the sidebar into the settings dialog.
- Caught in the browser, not by the tests: the toolbar was created before the module state it reads was declared
  (temporal dead zone). The setup now runs after the declarations, and a failing summary no longer breaks filtering.
  The jsdom harness bundles to an IIFE and does not enforce this, so such ordering errors need a real browser run.

### Stage 5 plan text

— Journal table (largest effect, highest risk)

Column model:

- A pure `table-column-model.js`: ordered list of `{ key, labelHe, group, defaultVisible, locked }` with the same
  order as today's 19 cells, so the key ↔ index map is explicit and testable.
- Groups: **core** (code, date, details, supplier, gross, net, VAT; locked), **tax** (supplier ID, reference,
  allocation number, VAT recognised %, expense recognised %), **AI** (agent decision, confidence), **service**
  (image, for export, delete, status).
- Default "Minimum" preset: #, code, date, details, supplier, reference, gross, net, VAT, status, image.
  Hidden by default: supplier ID, allocation number, both recognition %, agent decision, confidence, for export.
  Presets: Minimum, Full, Reset. Changing the default set is a one-line edit.
- Persistence: `common/ui-settings.json` in the data root (schema 1) plus a small store module; fallback to defaults
  when absent.

Controls (combination chosen after discussion):

1. "Columns" button in the table toolbar: popover with grouped checkboxes and presets.
2. A hide icon in every header (visible on hover).
3. A hidden column stays as a narrow stub with a "+" in its header, so it can be restored in place.

Implementation constraints:

- Hide via `<col>` (`visibility: collapse`, or a stub width) plus a generated `<style>` using the column keys; no cell
  is touched, so `row.cells[N]` keeps working. A short spike at the start of the stage must confirm
  `visibility: collapse` on `<col>` with `table-layout: fixed` in Chromium (RTL), otherwise fall back to per-cell classes.
- `table-columns.js` (resizers, widths in `localStorage` key `rivhit-table-column-widths-v3`) changes minimally: skip
  hidden neighbours when redistributing width; bump the key to `v4` because the semantics change.
- Validation errors that concern a hidden column get a "show column" link in the error list
  (`export-validation-dialog`, row errors in the close/import paths).
- A subtle marker in the VAT cell when recognition is not 100 % (so partial recognition is visible while its columns
  are hidden).

Look and behaviour:

- Table inside the scrolling middle region: sticky header, sticky first columns (#, code), `tabular-nums` right-aligned
  amounts, no wrapping of numbers, quiet inputs (border only on hover and focus, Excel-like), status badges instead of
  coloured text, delete as a row icon with confirm instead of a red button per row, row selection (kept in state for
  the future AI assistant).
- Toolbar above the table: filters (all · needs review · duplicates · not for export), columns button, search.
- Totals footer: row count, net, VAT, gross of the visible rows.
- Risks: sticky plus fixed layout plus RTL; hover and zebra contrast; `renderRow`-style code creates cells in several
  places (`addPendingRecord` and the restore path), so the class/data attributes for column keys are added in one
  helper called from both.

### Stage 6 — Dialogs and the Excel import wizard

- One dialog template: title without a coloured bar, quiet close icon, label above field, footer with the primary
  action first and "cancel" next to it, fixed size that never changes when a button is pressed, result plates inside
  the dialog next to the button.
- Restyle all `workspace-dialog`s (confirm, new declaration, client menu, custom classification, classification
  management, export validation / result, upload mode, passkey).
- Excel import: stepper "File → Month → Check → Done" in the same fixed-size dialog; logic in `excel-import-flow.js`
  unchanged, `excel-import-ui.js` reorganised only in how it shows the existing elements. Existing ids stay.

### Stage 7 — Reports dialog and viewer

- Reports dialog: two columns (parameters, preview), larger preview, status next to the buttons.
- `report-viewer.js` styles from the shared tokens (buttons, bar, fonts). The generated PDF stays Rivhit-like and is not
  touched.

### Stage 8 — Clean-up and polish

- Delete dead rules and the remaining minified blocks; one CSS entry list in `index.html`.
- Keyboard: Esc and Enter consistent in every dialog, visible focus everywhere, tooltips on icon buttons.
- Short empty and loading states with an action (no filler text on the front page).
- Update `docs/HANDOFF.md`, `docs/MIGRATION_HANDOFF.md`, `telegram-web/README.md` (screens, files, ids, column model).

## Order and checkpoints

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. After stages 2, 4 and 5 Vitalik reviews a screenshot or the published page before the
next stage. Stage 5 is the largest and starts with the column-collapse spike.

## Out of scope (separate decisions)

- Client tax ID storage; the AI assistant itself; backups; closed-declaration recovery.
- Removing the Rivhit export code (only hidden from the UI here).
- Any change to the PDF look of the reports.
- Checking that the name ANNATERIA is free.
