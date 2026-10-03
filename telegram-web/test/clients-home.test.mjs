import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createClientsHome } from "../clients-home.js";

const page = () => new JSDOM(`<body><nav id="breadcrumb"></nav><section id="clients-view"></section><section id="client-view" hidden></section><div id="journal-view" hidden></div>
<aside id="workspaces-drawer" hidden></aside><button id="open-workspaces-drawer"></button><div id="new-client-form" hidden></div><button id="show-new-client"></button><button id="select-data-root"></button></body>`).window.document;
const declaration = (month) => ({ declaration: { declarationId: `d-${month}`, month, status: "open", archived: false } });
const clientA = { id: "a", clientName: "Alpha", config: { businessActivity: "x", businessKind: "home" }, directory: {}, declarations: [declaration("2026-03")] };
const controls = (calls) => ({
  getClients: () => ({ active: [clientA], archived: [], activeClientId: null, activeDeclarationId: null, hasRoot: true }),
  openDeclaration: async (id, month) => calls.push(["open", id, month]),
  newDeclaration: async (id) => calls.push(["new", id]),
  editClient: (id) => calls.push(["edit", id]),
});
const crumb = (doc) => [...doc.querySelector("#breadcrumb").children].map((node) => node.textContent);
const visible = (doc) => ["clients-view", "client-view", "journal-view"].filter((id) => !doc.getElementById(id).hidden);

test("the start view is the clients list with a one-item breadcrumb", () => {
  const doc = page(), home = createClientsHome(doc);
  home.bind(controls([]));
  assert.deepEqual(visible(doc), ["clients-view"]);
  assert.equal(doc.body.dataset.view, "clients");
  assert.deepEqual(crumb(doc), ["לקוחות"]);
  assert.equal(doc.querySelectorAll("#clients-view tbody tr").length, 1);
});

test("opening a client shows its card; its declaration opens through the workspace controls", () => {
  const doc = page(), calls = [], home = createClientsHome(doc);
  home.bind(controls(calls));
  doc.querySelector("#clients-view tbody button").click();
  assert.deepEqual(visible(doc), ["client-view"]);
  assert.deepEqual(crumb(doc), ["לקוחות", "›", "Alpha"]);
  doc.querySelector(".declaration-card").click();
  assert.deepEqual(calls, [["open", "a", "2026-03"]]);
});

test("the journal view shows client and month in the breadcrumb and links back to the card and the list", () => {
  const doc = page(), home = createClientsHome(doc);
  home.bind(controls([]));
  home.showJournal({ clientId: "a", month: "2026-03" });
  assert.deepEqual(visible(doc), ["journal-view"]);
  assert.deepEqual(crumb(doc), ["לקוחות", "›", "Alpha", "›", "03/2026"]);
  doc.querySelectorAll("#breadcrumb .crumb-link")[1].click();
  assert.deepEqual(visible(doc), ["client-view"]);
  doc.querySelector("#breadcrumb .crumb-link").click();
  assert.deepEqual(visible(doc), ["clients-view"]);
});

test("a client that disappeared sends the card back to the list", () => {
  const doc = page(), home = createClientsHome(doc);
  let clients = [clientA];
  home.bind({ ...controls([]), getClients: () => ({ active: clients, archived: [], hasRoot: true }) });
  doc.querySelector("#clients-view tbody button").click();
  clients = [];
  home.refresh();
  assert.deepEqual(visible(doc), ["clients-view"]);
});

test("the new-client button opens the drawer with the creation form", () => {
  const doc = page(), home = createClientsHome(doc);
  doc.querySelector("#open-workspaces-drawer").addEventListener("click", () => { doc.querySelector("#workspaces-drawer").hidden = false; });
  doc.querySelector("#show-new-client").addEventListener("click", () => { doc.querySelector("#new-client-form").hidden = false; });
  home.bind(controls([]));
  [...doc.querySelectorAll("#clients-view button")].find((node) => node.textContent === "+ לקוח חדש").click();
  assert.equal(doc.querySelector("#workspaces-drawer").hidden, false);
  assert.equal(doc.querySelector("#new-client-form").hidden, false);
});
