// Synthetic classification ledgers in the layout of the real Rivhit files (no client data).
export const LEDGER_SECTIONS = [
  { title: "הכנסות", accounts: [["110", "הכנסה חייבת"]] },
  { title: "עלות המכר", accounts: [["200", "ציוד ספורט מתכלה"]] },
  { title: "הוצאות הנהלה וכלליות", accounts: [["202", "משרדיות"], ["205", "ארנונה"], ["212", "ביגוד"], ["214", 'הנה"ח']] },
  { title: "לא משתתף", accounts: [["900", "רכישת ציוד/רכוש קבוע"]] },
];

// Sheet grid: section title in column G, the code in M next to the label in N, the name in N of the next row.
export function ledgerGrid(sections = LEDGER_SECTIONS) {
  const line = () => Array(15).fill("");
  const grid = [line(), line()];
  for (const { title, accounts } of sections) {
    const section = line();
    section[6] = title;
    grid.push(section, line());
    for (const [code, name] of accounts) {
      const label = line();
      label[12] = code;
      label[13] = ":'קוד מס";
      const nameRow = line();
      nameRow[13] = name;
      const header = line();
      header[2] = 'מע"מ';
      header[8] = "פרטים";
      const detail = line();
      detail[0] = "טיוטא";
      detail[2] = "(18.00)";
      detail[8] = title === "הכנסות" ? "הכנסות" : "פרטים";
      const total = line();
      total[13] = `:סה''כ ${name}`;
      grid.push(label, nameRow, line(), header, detail, line(), total, line());
    }
  }
  return grid;
}

// pdf.js text items { str, x, y, width }: label at x 527, code left of it, name right below with the same right edge,
// section titles at the left margin; detail cells (also reading "הכנסות") elsewhere on the page.
export function ledgerPdfPages(sections = LEDGER_SECTIONS) {
  const page = [{ str: "כרטסת קודי מיון", x: 252, y: 772, width: 80 }, { str: "לתקופה: 1 - 12 2026", x: 268, y: 752, width: 70 }];
  let y = 728;
  for (const { title, accounts } of sections) {
    page.push({ str: title, x: 84, y, width: 60 });
    for (const [code, name] of accounts) {
      const width = 6 * name.length;
      page.push({ str: "קוד מס':", x: 527, y: y - 23, width: 36 }, { str: code, x: 502, y: y - 23, width: 20 });
      page.push({ str: name, x: 563 - width, y: y - 41, width });
      page.push({ str: "חשבון נגדי", x: 406, y: y - 70, width: 40 }, { str: "הכנסות", x: 336, y: y - 88, width: 40 }, { str: "(18.00)", x: 73, y: y - 88, width: 30 });
      page.push({ str: `סה''כ ${name}:`, x: 218, y: y - 110, width: 80 });
      y -= 130;
    }
  }
  return [page];
}
