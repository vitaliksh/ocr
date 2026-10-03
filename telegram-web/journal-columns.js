// Journal table columns in the browser: hide and restore columns (stubs stay in place), the column chooser, drag
// resizing, and the generated stylesheet. Cells are never removed or reordered, so app.js can keep using row.cells[N].
import { COLUMNS, GROUP_LABELS, PRESET_HIDDEN, STUB_PX, columnPercents, isLocked, normaliseHidden, stubCss, toggleHidden, weightsFromWidths } from "./table-column-model.js";

export const WIDTHS_KEY = "annateria-column-widths-v1";
const MIN_WIDTH_PX = 38;

function readWeights(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(WIDTHS_KEY));
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

export function setupJournalColumns({ table, menu, storage = globalThis.localStorage, onChange = () => {} }) {
  const doc = table.ownerDocument;
  const headers = [...table.tHead.rows[0].cells];
  if (headers.length !== COLUMNS.length || headers.some((header, index) => header.dataset.col !== COLUMNS[index].key)) {
    throw new Error("The journal header does not match the column model.");
  }
  const labels = headers.map((header) => header.textContent.trim());
  let hidden = [...PRESET_HIDDEN.minimum];
  let weights = readWeights(storage);

  const colgroup = doc.createElement("colgroup");
  const cols = headers.map(() => colgroup.appendChild(doc.createElement("col")));
  table.prepend(colgroup);
  const style = doc.createElement("style");
  style.id = "journal-columns-style";
  doc.head.append(style);

  const tablePx = () => table.getBoundingClientRect().width;
  const apply = () => {
    const width = tablePx();
    const percents = columnPercents(hidden, { stubPercent: width > 0 ? (STUB_PX / width) * 100 : 2, weights });
    percents.forEach((percent, index) => { cols[index].style.width = `${percent}%`; });
    style.textContent = stubCss(hidden, `#${table.id}`);
    headers.forEach((header, index) => {
      const isStub = hidden.includes(COLUMNS[index].key);
      header.classList.toggle("col-stub", isStub);
      header.title = isStub ? `הצגת העמודה: ${labels[index]}` : "";
    });
    syncChooser();
  };

  // Hide buttons and resize handles inside the header cells
  headers.forEach((header, index) => {
    const column = COLUMNS[index];
    if (!column.locked) {
      const hide = doc.createElement("button");
      hide.type = "button";
      hide.className = "col-hide";
      hide.textContent = "×";
      hide.title = `הסתרת העמודה: ${labels[index]}`;
      hide.setAttribute("aria-label", hide.title);
      hide.addEventListener("click", (event) => { event.stopPropagation(); setHidden(toggleHidden(hidden, column.key)); });
      header.append(hide);
    }
    header.addEventListener("click", () => {
      if (hidden.includes(column.key)) setHidden(toggleHidden(hidden, column.key));
    });
  });
  headers.slice(0, -1).forEach((header, index) => {
    const handle = doc.createElement("span");
    handle.className = "column-resizer";
    handle.title = "גרור לשינוי רוחב העמודה";
    handle.setAttribute("aria-label", "שינוי רוחב העמודה");
    header.append(handle);
    handle.addEventListener("click", (event) => event.stopPropagation());
    handle.addEventListener("pointerdown", (event) => {
      if (hidden.includes(COLUMNS[index].key)) return;
      const next = COLUMNS.findIndex((column, position) => position > index && !hidden.includes(column.key));
      if (next < 0) return;
      event.preventDefault();
      event.stopPropagation();
      const initial = headers.map((cell) => cell.getBoundingClientRect().width);
      const startX = event.clientX;
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        // Right-to-left: dragging to the left widens this column and narrows the one after it.
        const change = Math.max(MIN_WIDTH_PX - initial[index], Math.min(initial[next] - MIN_WIDTH_PX, startX - moveEvent.clientX));
        const widths = [...initial];
        widths[index] += change;
        widths[next] -= change;
        weights = weightsFromWidths(hidden, widths);
        apply();
      };
      const stop = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        try { storage?.setItem(WIDTHS_KEY, JSON.stringify(weights)); } catch { /* storage blocked */ }
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
  });

  // Chooser: grouped checkboxes and presets
  const panel = menu?.querySelector(".menu-panel");
  const boxes = new Map();
  function buildChooser() {
    if (!panel) return;
    panel.replaceChildren();
    for (const [group, groupLabel] of Object.entries(GROUP_LABELS)) {
      const members = COLUMNS.map((column, index) => ({ column, index })).filter(({ column }) => column.group === group);
      if (!members.length) continue;
      const section = doc.createElement("div");
      section.className = "columns-group";
      const title = doc.createElement("p");
      title.className = "menu-note";
      title.textContent = groupLabel;
      section.append(title);
      for (const { column, index } of members) {
        const label = doc.createElement("label");
        label.className = "columns-option";
        const box = doc.createElement("input");
        box.type = "checkbox";
        box.disabled = Boolean(column.locked);
        box.addEventListener("change", () => setHidden(toggleHidden(hidden, column.key)));
        label.append(box, doc.createTextNode(labels[index]));
        boxes.set(column.key, box);
        section.append(label);
      }
      panel.append(section);
    }
    const presets = doc.createElement("div");
    presets.className = "columns-presets";
    for (const [label, list] of [["מינימום", PRESET_HIDDEN.minimum], ["הכול", PRESET_HIDDEN.full]]) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "secondary small";
      button.textContent = label;
      button.addEventListener("click", () => setHidden(list));
      presets.append(button);
    }
    panel.append(presets);
  }
  function syncChooser() {
    for (const [key, box] of boxes) box.checked = !hidden.includes(key);
    const count = menu?.querySelector("summary");
    if (count) count.dataset.hidden = String(hidden.length);
  }

  function setHidden(list, { persist = true } = {}) {
    hidden = normaliseHidden(list);
    apply();
    if (persist) onChange([...hidden]);
  }

  buildChooser();
  apply();
  if (typeof ResizeObserver === "function") new ResizeObserver(apply).observe(table);

  return { setHidden, getHidden: () => [...hidden], apply, isLocked };
}
