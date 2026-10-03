// Journal toolbar: filter chips, search and the totals row. Works on the rendered rows only (app.js stays untouched):
// a row counts as "needs review" when its status cell has the review class, "duplicate" when app.js marked it, and
// "excluded" when it is unchecked (such rows are left out of the reports).

export const FILTERS = [
  { key: "all", label: "הכול" },
  { key: "review", label: "לבדיקה" },
  { key: "duplicate", label: "כפילויות" },
  { key: "excluded", label: "מחוץ לדוחות" },
];

const rowCells = (row) => row.cells || [];

export function rowKinds(row) {
  const status = rowCells(row)[16];
  return {
    review: Boolean(status?.classList.contains("review")),
    duplicate: row.dataset?.duplicate === "true",
    excluded: row.classList.contains("not-for-export"),
  };
}

export function matchesFilter(row, filter) {
  if (filter === "all") return true;
  return rowKinds(row)[filter] === true;
}

// Text a user can see or edit in the row, inputs and selects included.
export function rowText(row) {
  const fields = [...row.querySelectorAll("input:not([type=checkbox]), select")].map((field) => (field.tagName === "SELECT" ? field.selectedOptions[0]?.textContent ?? "" : field.value));
  return `${row.textContent} ${fields.join(" ")}`.toLowerCase();
}

export function matchesSearch(row, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  return !needle || rowText(row).includes(needle);
}

function amountOf(cell) {
  const field = cell?.querySelector("input");
  const value = Number(String(field ? field.value : cell?.textContent ?? "").replace(/,/g, "").trim());
  return Number.isFinite(value) ? value : 0;
}

// Sums over the included (checked) rows, rounded to agorot.
export function totals(rows) {
  const included = rows.filter((row) => !rowKinds(row).excluded);
  const sum = (index) => Math.round(included.reduce((total, row) => total + amountOf(rowCells(row)[index]), 0) * 100) / 100;
  return { rows: rows.length, included: included.length, gross: sum(8), net: sum(9), vat: sum(10) };
}

export const formatAmount = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function setupJournalToolbar({ records, chips, search, footer }) {
  const doc = records.ownerDocument;
  let filter = "all";
  let query = "";
  const dataRows = () => [...records.querySelectorAll("tr[data-document-id]")];

  const buttons = FILTERS.map(({ key, label }) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.dataset.filter = key;
    button.addEventListener("click", () => { filter = key; refresh(); });
    chips.append(button);
    return { key, label, button };
  });

  function refresh() {
    const rows = dataRows();
    for (const { key, label, button } of buttons) {
      const number = key === "all" ? rows.length : rows.filter((row) => matchesFilter(row, key)).length;
      button.textContent = key === "all" ? label : `${label} · ${number}`;
      button.setAttribute("aria-pressed", String(key === filter));
      button.hidden = key !== "all" && key !== filter && number === 0;
    }
    if (filter !== "all" && !rows.some((row) => matchesFilter(row, filter))) filter = "all";
    for (const row of rows) row.hidden = !(matchesFilter(row, filter) && matchesSearch(row, query));
    if (footer) {
      const sums = totals(rows.filter((row) => !row.hidden));
      footer.hidden = rows.length === 0;
      const cells = footer.rows[0].cells;
      cells[3].textContent = `סה״כ · ${sums.included} שורות`;
      cells[8].textContent = formatAmount(sums.gross);
      cells[9].textContent = formatAmount(sums.net);
      cells[10].textContent = formatAmount(sums.vat);
    }
  }

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    (globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0)))(() => { scheduled = false; refresh(); });
  };
  search?.addEventListener("input", () => { query = search.value; refresh(); });
  records.addEventListener("input", schedule);
  records.addEventListener("change", schedule);
  const Observer = doc.defaultView?.MutationObserver;
  if (Observer) new Observer(schedule).observe(records, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-duplicate"], characterData: true });
  refresh();
  return { refresh, getFilter: () => filter };
}
