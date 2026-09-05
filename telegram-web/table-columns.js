(() => {
  const table = document.querySelector(".table-wrap table");
  if (!table || !window.localStorage) return;

  const storageKey = "rivhit-table-column-widths-v1";
  const headers = [...table.tHead.rows[0].cells];
  const minimumWidth = 38;
  const colgroup = document.createElement("colgroup");
  const columns = headers.map(() => {
    const col = document.createElement("col");
    colgroup.append(col);
    return col;
  });
  table.prepend(colgroup);

  function readSavedWidths() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      return Array.isArray(saved) && saved.length === headers.length && saved.every(Number.isFinite) ? saved : null;
    } catch {
      return null;
    }
  }

  function applyWidths(widths) {
    widths.forEach((width, index) => { columns[index].style.width = `${width}%`; });
  }

  function currentWidths() {
    const tableWidth = table.getBoundingClientRect().width;
    return headers.map((header) => header.getBoundingClientRect().width / tableWidth * 100);
  }

  function saveWidths() {
    try { localStorage.setItem(storageKey, JSON.stringify(currentWidths())); } catch {}
  }

  applyWidths(readSavedWidths() || currentWidths());

  headers.slice(0, -1).forEach((header, index) => {
    const handle = document.createElement("span");
    handle.className = "column-resizer";
    handle.title = "גרור לשינוי רוחב העמודה";
    handle.setAttribute("aria-label", "שינוי רוחב העמודה");
    header.append(handle);

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const initial = currentWidths();
      const tableWidth = table.getBoundingClientRect().width;
      const startX = event.clientX;
      handle.setPointerCapture(event.pointerId);

      const move = (moveEvent) => {
        const change = (startX - moveEvent.clientX) / tableWidth * 100;
        const currentPixels = initial[index] / 100 * tableWidth;
        const nextPixels = initial[index + 1] / 100 * tableWidth;
        const limitedChange = Math.max(
          (minimumWidth - currentPixels) / tableWidth * 100,
          Math.min((nextPixels - minimumWidth) / tableWidth * 100, change)
        );
        const widths = [...initial];
        widths[index] += limitedChange;
        widths[index + 1] -= limitedChange;
        applyWidths(widths);
      };

      const stop = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        saveWidths();
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
  });
})();
