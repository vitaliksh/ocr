import { jpegPagesToPdf } from "./document-package.js";

const PAGE_WIDTH = 1240, PAGE_HEIGHT = 1754, RENDER_SCALE = 2, MARGIN = 70;
const FIELDS = [["תאריך", 0], ["ספק", 3], ["מס׳ מסמך", 5], ["כולל מע״מ", 7], ["מע״מ", 9], ["פרטים", 2], ["קוד מיון", 1], ["ע.מ./ת.ז", 4], ["מספר הקצאה", 6], ["ללא מע״מ", 8], ["% מוכר מע״מ", 10], ["% מוכר כהוצאה", 11]];

function makeCanvas() { const canvas = document.createElement("canvas"); canvas.width = PAGE_WIDTH * RENDER_SCALE; canvas.height = PAGE_HEIGHT * RENDER_SCALE; const context = canvas.getContext("2d"); context.scale(RENDER_SCALE, RENDER_SCALE); context.fillStyle = "white"; context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT); return { canvas, context }; }
async function canvasJpeg(canvas) { const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.96)); if (!blob) throw new Error("לא ניתן ליצור תמונת PDF."); return new Uint8Array(await blob.arrayBuffer()); }
function drawText(context, text, x, y, font = "18px Arial", color = "#172033") { context.fillStyle = color; context.font = font; context.direction = "rtl"; context.textAlign = "right"; context.textBaseline = "middle"; context.fillText(text, x, y); }
function fitText(context, text, width) { const value = String(text ?? "—"); if (context.measureText(value).width <= width) return value; let end = value.length; while (end && context.measureText(`${value.slice(0, end)}…`).width > width) end -= 1; return `${value.slice(0, end)}…`; }
function drawCompactField(context, label, value, x, y, width) { context.font = "bold 16px Arial"; context.direction = "rtl"; context.textAlign = "right"; context.textBaseline = "middle"; context.fillStyle = "#365466"; context.fillText(`${label}:`, x + width, y); const labelWidth = context.measureText(`${label}:`).width + 12; context.font = "16px Arial"; context.fillStyle = "#172033"; context.fillText(fitText(context, value, width - labelWidth), x + width - labelWidth, y); }
function drawImageContain(context, image, x, y, width, height) {
  context.fillStyle = "#f4f7fa"; context.fillRect(x, y, width, height); context.strokeStyle = "#9aa8b2"; context.lineWidth = 2; context.strokeRect(x, y, width, height);
  const scale = Math.min(width / image.width, height / image.height), imageWidth = image.width * scale, imageHeight = image.height * scale, result = { x: x + (width - imageWidth) / 2, y: y + (height - imageHeight) / 2, width: imageWidth, height: imageHeight };
  context.drawImage(image, result.x, result.y, result.width, result.height); return result;
}
function drawHighlights(context, regions, imageBox) {
  for (const region of regions || []) { const [top, left, bottom, right] = region.box_2d || []; if (![top, left, bottom, right].every(Number.isFinite) || top >= bottom || left >= right) continue; const x = imageBox.x + left / 1000 * imageBox.width, y = imageBox.y + top / 1000 * imageBox.height, width = (right - left) / 1000 * imageBox.width, height = (bottom - top) / 1000 * imageBox.height, amount = ["total_amount", "vat_amount"].includes(region.field); context.fillStyle = amount ? "#40b95a55" : "#ffe84d77"; context.strokeStyle = amount ? "#158c36" : "#c3a400"; context.lineWidth = Math.max(3, imageBox.width / 260); context.fillRect(x, y, width, height); context.strokeRect(x, y, width, height); }
}

// Each selected record gets a nearly full-page source image. Gemini's normalized
// source-text boxes are overlaid as yellow document markers or green amount markers.
export async function buildPdfReport({ clientName, createdAt, rows }) {
  const pages = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex], { canvas, context } = makeCanvas();
    drawText(context, "דו״ח מסמך", PAGE_WIDTH - MARGIN, 68, "bold 29px Arial"); drawText(context, `לקוח: ${clientName} · רשומה ${rowIndex + 1}/${rows.length}`, PAGE_WIDTH - MARGIN, 102, "17px Arial", "#365466"); drawText(context, "צהוב: פרטי מסמך · ירוק: סכום ומע״מ", PAGE_WIDTH - MARGIN, 132, "15px Arial", "#526074");
    if (!row.imageBlob) throw new Error("לא נמצאה תמונה עבור שורה פעילה.");
    const image = await createImageBitmap(row.imageBlob); try { const imageBox = drawImageContain(context, image, MARGIN, 158, PAGE_WIDTH - MARGIN * 2, 1110); drawHighlights(context, row.highlights, imageBox); } finally { image.close?.(); }
    context.strokeStyle = "#ccd7de"; context.beginPath(); context.moveTo(MARGIN, 1300); context.lineTo(PAGE_WIDTH - MARGIN, 1300); context.stroke(); drawText(context, "פענוח", PAGE_WIDTH - MARGIN, 1334, "bold 21px Arial");
    let y = 1370; for (let index = 0; index < FIELDS.length; index += 2) { const [rightLabel, rightValue] = FIELDS[index], [leftLabel, leftValue] = FIELDS[index + 1]; drawCompactField(context, rightLabel, row.values[rightValue], PAGE_WIDTH / 2 + 12, y, PAGE_WIDTH / 2 - MARGIN - 12); drawCompactField(context, leftLabel, row.values[leftValue], MARGIN, y, PAGE_WIDTH / 2 - MARGIN - 12); y += 45; }
    drawText(context, `נוצר: ${new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(createdAt)}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 38, "14px Arial", "#526074"); pages.push(await canvasJpeg(canvas));
  }
  return new Blob([jpegPagesToPdf(pages, PAGE_WIDTH * RENDER_SCALE, PAGE_HEIGHT * RENDER_SCALE, PAGE_WIDTH, PAGE_HEIGHT)], { type: "application/pdf" });
}
