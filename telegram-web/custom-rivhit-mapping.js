const filename = "custom-rivhit-mapping.json";

function cleanLabel(value) { return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim().slice(0, 120); }
function validCode(value) { return /^\d{3}$/.test(String(value ?? "")); }
export function normaliseCustomMapping(value, builtIn = {}) {
  const codes = {};
  for (const [code, label] of Object.entries(value?.codes || {})) if (validCode(code) && !builtIn[code] && cleanLabel(label)) codes[code] = cleanLabel(label);
  return codes;
}
function validTimestamp(value) { return Number.isFinite(Date.parse(value)); }
export function normaliseCustomMappingMetadata(value, builtIn = {}) {
  const codes = normaliseCustomMapping(value, builtIn), metadata = {};
  for (const code of Object.keys(codes)) { const createdAt = value?.metadata?.[code]?.createdAt; if (validTimestamp(createdAt)) metadata[code] = { createdAt }; }
  return metadata;
}
async function readJson(directory, name) { return JSON.parse(await (await directory.getFileHandle(name)).getFile().then((file) => file.text())); }
async function writeJson(directory, name, value) { const writable = await (await directory.getFileHandle(name, { create: true })).createWritable(); try { await writable.write(JSON.stringify(value, null, 2)); } finally { await writable.close(); } }

export async function readCustomRivhitMapping(dataRoot, builtIn) {
  if (!dataRoot) return {};
  try { return normaliseCustomMapping(await readJson(await dataRoot.getDirectoryHandle("common"), filename), builtIn); }
  catch (error) { if (error.name === "NotFoundError") return {}; throw error; }
}
export async function readCustomRivhitMappingMetadata(dataRoot, builtIn) {
  if (!dataRoot) return {};
  try { return normaliseCustomMappingMetadata(await readJson(await dataRoot.getDirectoryHandle("common"), filename), builtIn); }
  catch (error) { if (error.name === "NotFoundError") return {}; throw error; }
}
export async function saveCustomRivhitMapping(dataRoot, codes, builtIn) {
  if (!dataRoot) throw new Error("יש לבחור תחילה תיקיית נתונים.");
  const common = await dataRoot.getDirectoryHandle("common", { create: true }), normalised = normaliseCustomMapping({ codes }, builtIn); let previous = {};
  try { previous = await readJson(common, filename); } catch (error) { if (error.name !== "NotFoundError") throw error; }
  const oldMetadata = normaliseCustomMappingMetadata(previous, builtIn), metadata = {}, now = new Date().toISOString();
  for (const code of Object.keys(normalised)) metadata[code] = oldMetadata[code] || { createdAt: now };
  await writeJson(common, filename, { schemaVersion: 2, codes: normalised, metadata });
  return normalised;
}
