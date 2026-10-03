import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { FILTERS, formatAmount, matchesFilter, matchesSearch, rowKinds, setupJournalToolbar, totals } from "../journal-toolbar.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8").replace(/<script\b[^>]*><\/script>/g, "");

function page() {
  const dom = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  const { document } = dom.window;
  const records = document.querySelector("#records");
  records.replaceChildren();
  const addRow = ({ id, supplier = "ספק", gross = "118.00", net = "100.00", vat = "18.00", state = "ready", duplicate = false, excluded = false }) => {
    const row = document.createElement("tr");
    row.dataset.documentId = id;
    if (duplicate) row.dataset.duplicate = "true";
    if (excluded) row.classList.add("not-for-export");
    for (let index = 0; index < 19; index += 1) row.append(document.createElement("td"));
    row.cells[4].textContent = supplier;
    for (const [index, value] of [[8, gross], [9, net]]) {
      const input = document.createElement("input");
      input.value = value;
      row.cells[index].append(input);
    }
    row.cells[10].textContent = vat;
    row.cells[16].className = `state ${state}`;
    row.cells[16].textContent = state;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !excluded;
    row.cells[17].append(box);
    records.append(row);
    return row;
  };
  return { dom, document, records, addRow };
}

test("row kinds come from the status class, the duplicate mark and the excluded class", () => {
  const { addRow } = page();
  const row = addRow({ id: "a", state: "review", duplicate: true, excluded: true });
  assert.deepEqual(rowKinds(row), { review: true, duplicate: true, excluded: true });
  assert.equal(matchesFilter(row, "all"), true);
  assert.equal(matchesFilter(addRow({ id: "b" }), "review"), false);
  assert.deepEqual(FILTERS.map((filter) => filter.key), ["all", "review", "duplicate", "excluded"]);
});

test("search looks at cell text and at field values", () => {
  const { addRow } = page();
  const row = addRow({ id: "a", supplier: "בזק" });
  assert.equal(matchesSearch(row, "בזק"), true);
  assert.equal(matchesSearch(row, "118.00"), true);
  assert.equal(matchesSearch(row, "nope"), false);
  assert.equal(matchesSearch(row, "  "), true);
});

test("totals sum the included rows only and round to agorot", () => {
  const { addRow } = page();
  const rows = [addRow({ id: "a", gross: "1,000.10", net: "847.54", vat: "152.56" }), addRow({ id: "b", gross: "0.20", net: "0.17", vat: "0.03" }), addRow({ id: "c", gross: "999", net: "999", vat: "0", excluded: true })];
  assert.deepEqual(totals(rows), { rows: 3, included: 2, gross: 1000.3, net: 847.71, vat: 152.59 });
  assert.equal(formatAmount(1234.5), "1,234.50");
});

test("the toolbar counts, filters, searches and keeps the totals row in step with the visible rows", async () => {
  const { document, records, addRow, dom } = page();
  addRow({ id: "a", supplier: "בזק" });
  addRow({ id: "b", supplier: "פז", state: "review", duplicate: true });
  addRow({ id: "c", supplier: "גז", excluded: true, gross: "50.00", net: "50.00", vat: "0.00" });
  const chips = document.querySelector("#journal-filters"), footer = document.querySelector("#journal-totals");
  const toolbar = setupJournalToolbar({ records, chips, search: document.querySelector("#journal-search"), footer });
  const labels = () => [...chips.querySelectorAll(".chip")].filter((chip) => !chip.hidden).map((chip) => chip.textContent);
  assert.deepEqual(labels(), ["הכול", "לבדיקה · 1", "כפילויות · 1", "מחוץ לדוחות · 1"]);
  assert.equal(footer.hidden, false);
  assert.equal(footer.rows[0].cells[8].textContent, "236.00");
  assert.match(footer.rows[0].cells[3].textContent, /2 שורות/);

  chips.querySelector('[data-filter="review"]').click();
  assert.deepEqual([...records.rows].map((row) => row.hidden), [true, false, true]);
  assert.equal(toolbar.getFilter(), "review");
  assert.equal(footer.rows[0].cells[8].textContent, "118.00");
  assert.equal(chips.querySelector('[data-filter="review"]').getAttribute("aria-pressed"), "true");

  chips.querySelector('[data-filter="all"]').click();
  const search = document.querySelector("#journal-search");
  search.value = "בזק";
  search.dispatchEvent(new dom.window.Event("input"));
  assert.deepEqual([...records.rows].map((row) => row.hidden), [false, true, true]);
  search.value = "";
  search.dispatchEvent(new dom.window.Event("input"));

  records.rows[1].cells[16].className = "state ready";
  records.rows[1].dataset.duplicate = "false";
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(labels().some((label) => label.startsWith("לבדיקה")), false);
});

test("an empty journal hides the totals row", () => {
  const { document, records } = page();
  setupJournalToolbar({ records, chips: document.querySelector("#journal-filters"), search: null, footer: document.querySelector("#journal-totals") });
  assert.equal(document.querySelector("#journal-totals").hidden, true);
});
