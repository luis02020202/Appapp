/* ============================================================
   Mosaik - App-Logik
   Alles läuft rein lokal auf dem Gerät (IndexedDB + localStorage).
   Keine Server, kein Konto, keine Cloud - wichtig bei Gesichts-
   und Körperfotos.
   ============================================================ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ---------- Icons (SF-Symbols-artiges, minimales Linien-Set) ---------- */
const ICON_PATHS = {
  face: '<circle cx="12" cy="8.3" r="3.6"/><path d="M4.6 19.6c0-4.2 3.3-6.8 7.4-6.8s7.4 2.6 7.4 6.8"/>',
  body: '<circle cx="12" cy="4.7" r="2.1"/><path d="M12 6.8v6.2"/><path d="M8.3 9.5L12 8.4l3.7 1.1"/><path d="M12 13l-3 7"/><path d="M12 13l3 7"/>',
  mind: '<path d="M12 20.1s-7.3-4.3-9.5-8.7C1.1 8 2.8 4.5 6.4 4.5c2.1 0 3.6 1.3 5.6 4 2-2.7 3.5-4 5.6-4 3.6 0 5.3 3.5 3.9 6.9-2.2 4.4-9.5 8.7-9.5 8.7z"/>',
  camera: '<rect x="3.2" y="7" width="17.6" height="12.6" rx="2.6"/><path d="M8.4 7l1.3-2.3h4.6L15.6 7"/><circle cx="12" cy="13.3" r="3.3"/>',
  gallery: '<rect x="3.2" y="4.3" width="17.6" height="15.4" rx="2.4"/><circle cx="8.6" cy="9.4" r="1.4"/><path d="M20.4 15.4l-4.6-4.5-3.8 3.7-2.6-2.5-4.8 4.7"/>',
  mic: '<rect x="9" y="3.2" width="6" height="11" rx="3"/><path d="M5.2 11a6.8 6.8 0 0013.6 0"/><path d="M12 17.8v3"/><path d="M9 21h6"/>',
  stop: '<rect x="7.5" y="7.5" width="9" height="9" rx="1.8"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5.2a1.2 1.2 0 011.2-1.2h2.6a1.2 1.2 0 011.2 1.2V7m-8 0v12.3A1.7 1.7 0 007 21h10a1.7 1.7 0 001.7-1.7V7"/>',
  pencil: '<path d="M4 20l4.3-1 10.4-10.4a2.2 2.2 0 00-3.1-3.1L5.2 15.9l-1.2 4.1z"/>',
  flame: '<path d="M12 21c4 0 6.4-2.6 6.4-6.1 0-2.4-1.2-3.9-2.3-5.2-.1 1.6-.9 2.4-1.7 2.8.4-2.5-.4-4.9-2.9-7.3-.3 2.5-1.4 3.8-2.8 5.3C7.3 12 6.1 13.2 6.1 15.3c0 3.4 2.5 5.7 5.9 5.7z"/>',
  mosaic: '<rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.8"/><rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.8"/><rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.8"/><rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.8"/>',
};
function icon(name, cls) {
  return `<svg class="icon${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ""}</svg>`;
}

const BLOCKS = {
  face: { id: "face", name: "Gesicht", desc: "Tägliches Foto deines Gesichts", icon: "face", accent: "#007AFF", kind: "photo" },
  body: { id: "body", name: "Körper", desc: "Tägliches Foto deines Körpers", icon: "body", accent: "#FF9500", kind: "photo" },
  mind: { id: "mind", name: "Mentale Gesundheit", desc: "Text oder Sprachnachricht", icon: "mind", accent: "#AF52DE", kind: "mind" },
};
const BLOCK_ORDER = ["face", "body", "mind"];
const COLORS = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#AF52DE"];

const LS_DIARIES = "mosaik_diaries";
const LS_ENTRIES = "mosaik_entries";
const IDB_AVAILABLE = (() => { try { return !!window.indexedDB; } catch { return false; } })();

let state = {
  diaries: [],
  entries: [],
  currentDiaryId: null,
  currentDate: null,
  currentBlock: null,
  newDiaryColor: COLORS[4],
  newDiaryBlocks: new Set(),
  pendingPhotoFile: null,
  photoReturnScreen: "diary",
  mindReturnScreen: "diary",
  mediaRecorder: null,
  mediaStream: null,
  recChunks: [],
  recTimerInterval: null,
  recSeconds: 0,
  pendingAudioBlob: null,
  pendingAudioMime: "",
};

/* ---------- Helpers ---------- */
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2)); }
function pad(n) { return String(n).padStart(2, "0"); }
function dateKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDateKey(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(dateStr, delta) { const d = parseDateKey(dateStr); d.setDate(d.getDate() + delta); return dateKey(d); }
function todayKey() { return dateKey(new Date()); }
function dayLabelFor(dateStr) {
  if (dateStr === todayKey()) return "Heute";
  if (dateStr === addDays(todayKey(), -1)) return "Gestern";
  return parseDateKey(dateStr).toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}
function dayLabelLong(dateStr) {
  if (dateStr === todayKey()) return "Heute";
  if (dateStr === addDays(todayKey(), -1)) return "Gestern";
  return parseDateKey(dateStr).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
function errMsg(e) { return (e && (e.message || e.name)) ? (e.message || e.name) : String(e || "Unbekannter Fehler"); }
function go(id) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  const el = document.getElementById(id);
  el.classList.add("active");
  const sc = el.querySelector(".scroll");
  if (sc) sc.scrollTop = 0;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 3200);
}

/* ---------- Persistence: diaries / entries (localStorage) ---------- */
function loadDiaries() { try { return JSON.parse(localStorage.getItem(LS_DIARIES)) || []; } catch { return []; } }
function saveDiaries() { localStorage.setItem(LS_DIARIES, JSON.stringify(state.diaries)); }
function loadEntries() { try { return JSON.parse(localStorage.getItem(LS_ENTRIES)) || []; } catch { return []; } }
function saveEntries() { localStorage.setItem(LS_ENTRIES, JSON.stringify(state.entries)); }

function getDiary(id) { return state.diaries.find((d) => d.id === id) || null; }
function getEntry(diaryId, date, block) {
  return state.entries.find((e) => e.diaryId === diaryId && e.date === date && e.block === block) || null;
}
function entriesForDiary(diaryId) { return state.entries.filter((e) => e.diaryId === diaryId); }

function storageKeyFor(diaryId, date, block, kind) { return `${kind}_${diaryId}_${date}_${block}`; }

async function upsertEntry(diaryId, date, block, data) {
  const existing = getEntry(diaryId, date, block);
  if (existing) {
    if (existing.storageKey && existing.storageKey !== data.storageKey) await idbDelete(existing.storageKey);
    Object.assign(existing, data, { updatedAt: new Date().toISOString() });
  } else {
    state.entries.push({ id: uid(), diaryId, date, block, createdAt: new Date().toISOString(), ...data });
  }
  saveEntries();
}

async function deleteEntry(diaryId, date, block) {
  const existing = getEntry(diaryId, date, block);
  if (!existing) return;
  if (existing.storageKey) await idbDelete(existing.storageKey);
  state.entries = state.entries.filter((e) => e !== existing);
  saveEntries();
}

async function deleteDiary(diaryId) {
  const es = entriesForDiary(diaryId);
  for (const e of es) if (e.storageKey) await idbDelete(e.storageKey);
  state.entries = state.entries.filter((e) => e.diaryId !== diaryId);
  state.diaries = state.diaries.filter((d) => d.id !== diaryId);
  saveEntries(); saveDiaries();
}

/* ============================================================
   IndexedDB (Foto- / Audio-Blobs)

   Wichtig für Safari/iOS: wir speichern ArrayBuffer + MIME-Type statt
   des rohen Blob/File-Objekts (manche WebKit-Versionen serialisieren
   Blobs beim structured clone unzuverlässig) und schließen jede
   Verbindung sofort nach der Transaktion wieder, statt sie offen zu
   lassen. Jeder Fehler wird mit einer echten Meldung nach oben gereicht.
   ============================================================ */
function idbOpen() {
  if (!IDB_AVAILABLE) return Promise.reject(new Error("IndexedDB ist auf diesem Gerät nicht verfügbar"));
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open("mosaik", 1); } catch (e) { return reject(e); }
    req.onupgradeneeded = () => { try { req.result.createObjectStore("files"); } catch {} };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB konnte nicht geöffnet werden"));
    req.onblocked = () => reject(new Error("IndexedDB ist blockiert (App evtl. in einem anderen Tab offen)"));
  });
}
function idbPutBuffer(key, buf, type) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ buf, type }, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Speichern in IndexedDB fehlgeschlagen")); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("Speichervorgang abgebrochen")); };
  }));
}
function idbGetBuffer(key) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const rq = tx.objectStore("files").get(key);
    tx.oncomplete = () => { db.close(); resolve(rq.result || null); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Lesen aus IndexedDB fehlgeschlagen")); };
  }));
}
function idbDelete(key) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Löschen fehlgeschlagen")); };
  }));
}
async function idbPut(key, fileOrBlob) {
  const buf = await fileOrBlob.arrayBuffer();
  await idbPutBuffer(key, buf, fileOrBlob.type || "application/octet-stream");
}
async function idbGet(key) {
  const rec = await idbGetBuffer(key);
  if (!rec) return null;
  return new Blob([rec.buf], { type: rec.type });
}
const urlCache = new Map();
async function blobUrlFor(key) {
  if (!key) return "";
  if (urlCache.has(key)) return urlCache.get(key);
  let url = "";
  try {
    const blob = await idbGet(key);
    url = blob ? URL.createObjectURL(blob) : "";
  } catch (e) { console.error(e); }
  urlCache.set(key, url);
  return url;
}
function invalidateUrl(key) {
  const u = urlCache.get(key);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(key);
}

/* ---------- Streak / Fortschritt ---------- */
function diaryComplete(diary, dateStr) {
  return diary.blocks.every((b) => !!getEntry(diary.id, dateStr, b));
}
function computeStreak(diary) {
  let streak = 0;
  let cursor = todayKey();
  if (diaryComplete(diary, cursor)) { streak++; cursor = addDays(cursor, -1); }
  else { cursor = addDays(cursor, -1); }
  while (diaryComplete(diary, cursor)) { streak++; cursor = addDays(cursor, -1); }
  return streak;
}
function todayDoneCount(diary) {
  return diary.blocks.filter((b) => !!getEntry(diary.id, todayKey(), b)).length;
}

/* ============================================================
   Home (Tagebuch-Liste)
   ============================================================ */
function renderHome() {
  $("#homeDate").textContent = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const list = $("#diaryList");
  list.innerHTML = "";
  $("#homeEmpty").classList.toggle("hidden", state.diaries.length > 0);
  state.diaries.forEach((diary) => list.appendChild(diaryRow(diary)));
}

function diaryRow(diary) {
  const row = document.createElement("div");
  row.className = "list-row diary-row";
  const streak = computeStreak(diary);
  const meta = diary.blocks.map((b) => BLOCKS[b].name).join(" · ");
  row.innerHTML = `
    <div class="row-glyph" style="background:${diary.color}">${icon(diary.blocks.length === 1 ? BLOCKS[diary.blocks[0]].icon : "mosaic")}</div>
    <div class="row-body">
      <div class="row-title">${escapeHtml(diary.name)}</div>
      <div class="row-sub">${escapeHtml(meta)}${streak > 0 ? ` · ${streak} ${streak === 1 ? "Tag" : "Tage"} Serie` : ""}</div>
    </div>
    <div class="row-trailing">
      <div class="prog">${diary.blocks.map((b) => `<span class="${getEntry(diary.id, todayKey(), b) ? "done" : ""}"></span>`).join("")}</div>
      ${icon("chevronRight", "chev")}
    </div>`;
  row.onclick = () => openDiary(diary.id);
  return row;
}

/* ============================================================
   Tagebuch erstellen
   ============================================================ */
function showCreateDiary() {
  state.newDiaryColor = COLORS[4];
  state.newDiaryBlocks = new Set();
  $("#dName").value = "";
  buildColorGrid();
  buildBlockPicker();
  updateCreateSubmit();
  go("createDiary");
}
function buildColorGrid() {
  const grid = $("#colorGrid");
  grid.innerHTML = "";
  COLORS.forEach((c) => {
    const b = document.createElement("button");
    b.style.background = c;
    if (c === state.newDiaryColor) b.classList.add("on");
    b.onclick = () => {
      state.newDiaryColor = c;
      $$("#colorGrid button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    };
    grid.appendChild(b);
  });
}
function buildBlockPicker() {
  const wrap = $("#blockPicker");
  wrap.innerHTML = "";
  BLOCK_ORDER.forEach((id) => {
    const b = BLOCKS[id];
    const el = document.createElement("div");
    el.className = "block-opt";
    el.innerHTML = `<div class="row-glyph sm" style="background:${b.accent}">${icon(b.icon)}</div><div class="row-body"><div class="row-title">${b.name}</div><div class="row-sub">${b.desc}</div></div><div class="check-circle">${icon("check")}</div>`;
    el.onclick = () => {
      if (state.newDiaryBlocks.has(id)) state.newDiaryBlocks.delete(id); else state.newDiaryBlocks.add(id);
      el.classList.toggle("on");
      updateCreateSubmit();
    };
    wrap.appendChild(el);
  });
}
function updateCreateSubmit() {
  $("#dSubmit").disabled = !($("#dName").value.trim() && state.newDiaryBlocks.size > 0);
}
function createDiary() {
  const name = $("#dName").value.trim();
  if (!name || state.newDiaryBlocks.size === 0) return;
  const diary = {
    id: uid(),
    name,
    color: state.newDiaryColor,
    blocks: BLOCK_ORDER.filter((b) => state.newDiaryBlocks.has(b)),
    createdAt: new Date().toISOString(),
  };
  state.diaries.push(diary);
  saveDiaries();
  toast("Tagebuch erstellt");
  openDiary(diary.id);
}

/* ============================================================
   Tagebuch-Detail
   ============================================================ */
function openDiary(diaryId) {
  state.currentDiaryId = diaryId;
  renderDiary();
  go("diary");
}
function renderDiary() {
  const diary = getDiary(state.currentDiaryId);
  if (!diary) return go("home");
  $("#diaryTitle").textContent = diary.name;
  const streak = computeStreak(diary);
  $("#diaryStreak").innerHTML = streak > 0 ? `${icon("flame")} ${streak} ${streak === 1 ? "Tag" : "Tage"} Serie` : "Heute starten";
  const done = todayDoneCount(diary);
  $("#diarySub").textContent = `${done} von ${diary.blocks.length} Bausteinen heute erledigt`;

  const todayWrap = $("#todayBlocks");
  todayWrap.innerHTML = "";
  diary.blocks.forEach((b) => todayWrap.appendChild(renderTodayBlockRow(diary, b)));

  renderHistoryGrid(diary);
}

function renderTodayBlockRow(diary, blockId) {
  const meta = BLOCKS[blockId];
  const entry = getEntry(diary.id, todayKey(), blockId);
  const row = document.createElement("div");
  row.className = "list-row" + (entry ? " done" : "");
  const glyph = document.createElement("div");
  glyph.className = "row-glyph";
  glyph.style.background = meta.accent;
  glyph.innerHTML = icon(meta.icon);
  row.appendChild(glyph);
  if (entry && entry.kind === "photo" && entry.storageKey) {
    blobUrlFor(entry.storageKey).then((url) => {
      if (!url) return;
      glyph.innerHTML = "";
      glyph.style.background = "transparent";
      const img = document.createElement("img");
      img.src = url; glyph.appendChild(img);
    });
  }
  const body = document.createElement("div");
  body.className = "row-body";
  let sub = meta.desc;
  if (entry) {
    if (entry.kind === "text") sub = entry.text.length > 42 ? entry.text.slice(0, 42) + "…" : entry.text;
    else if (entry.kind === "audio") sub = "Sprachnachricht gespeichert";
    else if (entry.kind === "photo") sub = "Foto gespeichert";
  }
  body.innerHTML = `<div class="row-title">${meta.name}</div><div class="row-sub">${escapeHtml(sub)}</div>`;
  row.appendChild(body);
  const trailing = document.createElement("div");
  trailing.className = "row-trailing";
  trailing.innerHTML = entry ? icon("check", "ok") : icon("chevronRight", "chev");
  row.appendChild(trailing);
  row.onclick = () => {
    state.photoReturnScreen = "diary"; state.mindReturnScreen = "diary";
    if (meta.kind === "photo") openPhotoEntry(diary.id, todayKey(), blockId);
    else openMindEntry(diary.id, todayKey());
  };
  return row;
}

function renderHistoryGrid(diary) {
  const created = dateKey(new Date(diary.createdAt));
  let daysSince = 0;
  { let c = todayKey(); while (c !== created && daysSince < 29) { daysSince++; c = addDays(c, -1); } }
  const n = Math.min(daysSince + 1, 30);
  const grid = $("#historyGrid");
  grid.innerHTML = "";
  const es = entriesForDiary(diary.id);
  $("#historyCount").textContent = es.length ? `${es.length} Einträge` : "";
  $("#historyEmpty").classList.toggle("hidden", es.length > 0);

  for (let i = 0; i < n; i++) {
    const date = addDays(todayKey(), -i);
    grid.appendChild(dayCell(diary, date));
  }
}

function dayCell(diary, date) {
  const cell = document.createElement("div");
  const anyEntry = diary.blocks.some((b) => !!getEntry(diary.id, date, b));
  const isToday = date === todayKey();
  cell.className = "daycell" + (anyEntry ? "" : " empty-day") + (isToday ? " today" : "");
  const dotsHtml = diary.blocks.map((b) => `<i class="${getEntry(diary.id, date, b) ? "on" : ""}"></i>`).join("");
  cell.innerHTML = `<span class="lbl">${parseDateKey(date).getDate()}</span><div class="dots">${dotsHtml}</div>`;
  const photoBlock = diary.blocks.find((b) => BLOCKS[b].kind === "photo" && getEntry(diary.id, date, b));
  if (photoBlock) {
    const entry = getEntry(diary.id, date, photoBlock);
    cell.classList.add("has-photo");
    blobUrlFor(entry.storageKey).then((url) => {
      if (!url) return;
      const img = document.createElement("img");
      img.src = url; cell.prepend(img);
    });
  }
  cell.onclick = () => openDayView(diary.id, date);
  return cell;
}

/* diary settings sheet */
function openDiarySheet() { $("#diarySheet").classList.add("on"); }
function closeDiarySheet() { $("#diarySheet").classList.remove("on"); }
function renameDiary() {
  const diary = getDiary(state.currentDiaryId);
  if (!diary) return;
  const name = window.prompt("Neuer Name für das Tagebuch:", diary.name);
  closeDiarySheet();
  if (name && name.trim()) { diary.name = name.trim(); saveDiaries(); renderDiary(); toast("Umbenannt"); }
}
async function removeDiaryFlow() {
  const diary = getDiary(state.currentDiaryId);
  closeDiarySheet();
  if (!diary) return;
  if (!confirm(`"${diary.name}" wirklich löschen? Alle Fotos, Texte und Sprachnachrichten dieses Tagebuchs werden entfernt.`)) return;
  try {
    await deleteDiary(diary.id);
    toast("Tagebuch gelöscht");
    go("home"); renderHome();
  } catch (e) { console.error(e); toast("Fehler beim Löschen: " + errMsg(e)); }
}

/* ============================================================
   Foto-Eintrag
   ============================================================ */
function openPhotoEntry(diaryId, date, block) {
  if (!IDB_AVAILABLE) { toast("Fotos können auf diesem Gerät nicht lokal gespeichert werden"); return; }
  state.currentDiaryId = diaryId; state.currentDate = date; state.currentBlock = block;
  state.pendingPhotoFile = null;
  $("#photoTitle").textContent = BLOCKS[block].name;
  $("#photoPill").textContent = dayLabelFor(date);
  $("#photoPrompt").textContent = BLOCKS[block].name + " festhalten";
  $("#photoChoice").classList.remove("hidden");
  $("#photoUpload").classList.add("hidden");
  $("#photoSaveBar").classList.add("hidden");
  $("#fileCam").value = ""; $("#fileGal").value = "";
  refreshExistingPhoto();
  go("entryPhoto");
}
async function refreshExistingPhoto() {
  const entry = getEntry(state.currentDiaryId, state.currentDate, state.currentBlock);
  const wrap = $("#photoExistingWrap");
  if (entry && entry.kind === "photo" && entry.storageKey) {
    const url = await blobUrlFor(entry.storageKey);
    $("#photoExisting").src = url;
    wrap.classList.remove("hidden");
  } else {
    wrap.classList.add("hidden");
  }
}
function onPhotoFilePicked(file) {
  if (!file) return;
  state.pendingPhotoFile = file;
  $("#photoPreview").src = URL.createObjectURL(file);
  $("#photoChoice").classList.add("hidden");
  $("#photoUpload").classList.remove("hidden");
  $("#photoSaveBar").classList.remove("hidden");
}
async function savePhoto() {
  if (!state.pendingPhotoFile) return;
  const { currentDiaryId: diaryId, currentDate: date, currentBlock: block } = state;
  const key = storageKeyFor(diaryId, date, block, "photo");
  $("#btnPhotoSave").disabled = true;
  try {
    await idbPut(key, state.pendingPhotoFile);
    invalidateUrl(key);
    await upsertEntry(diaryId, date, block, { kind: "photo", storageKey: key });
    toast("Foto gespeichert");
    backFromPhoto();
  } catch (e) {
    console.error(e);
    toast("Fehler beim Speichern: " + errMsg(e));
  } finally { $("#btnPhotoSave").disabled = false; }
}
async function deletePhotoEntry() {
  const { currentDiaryId: diaryId, currentDate: date, currentBlock: block } = state;
  if (!confirm("Diesen Eintrag löschen?")) return;
  try {
    const entry = getEntry(diaryId, date, block);
    if (entry && entry.storageKey) invalidateUrl(entry.storageKey);
    await deleteEntry(diaryId, date, block);
    toast("Eintrag gelöscht");
    refreshExistingPhoto();
    if (state.photoReturnScreen === "diary") renderDiary();
  } catch (e) { console.error(e); toast("Fehler beim Löschen: " + errMsg(e)); }
}
function backFromPhoto() {
  if (state.photoReturnScreen === "dayView") { renderDayView(); go("dayView"); }
  else { renderDiary(); go("diary"); }
}

/* ============================================================
   Mentale-Gesundheit-Eintrag (Text / Sprachnachricht)
   ============================================================ */
function openMindEntry(diaryId, date) {
  state.currentDiaryId = diaryId; state.currentDate = date; state.currentBlock = "mind";
  stopRecordingIfActive();
  resetAudioUi();
  $("#mindTitle").textContent = dayLabelFor(date);
  $("#btnRecToggle").classList.toggle("hidden", !IDB_AVAILABLE);
  $("#recHint").textContent = IDB_AVAILABLE ? "Tippe zum Aufnehmen" : "Auf diesem Gerät nicht verfügbar";
  const entry = getEntry(diaryId, date, "mind");
  if (entry && entry.kind === "audio") {
    switchMindTab("audio");
    showExistingAudio(entry);
  } else {
    switchMindTab("text");
    $("#mindText").value = entry && entry.kind === "text" ? entry.text : "";
  }
  $("#mindExistingWrap").classList.toggle("hidden", !entry);
  go("entryMind");
}
function switchMindTab(tab) {
  $$(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
  $("#mindTextPane").classList.toggle("hidden", tab !== "text");
  $("#mindAudioPane").classList.toggle("hidden", tab !== "audio");
  $("#btnMindTextSave").classList.toggle("hidden", tab !== "text");
  $("#btnMindAudioSave").classList.toggle("hidden", tab !== "audio");
}
async function saveMindText() {
  const text = $("#mindText").value.trim();
  if (!text) return toast("Bitte etwas schreiben");
  $("#btnMindTextSave").disabled = true;
  try {
    await upsertEntry(state.currentDiaryId, state.currentDate, "mind", { kind: "text", text, storageKey: null });
    toast("Gespeichert");
    backFromMind();
  } catch (e) { console.error(e); toast("Fehler beim Speichern: " + errMsg(e)); }
  finally { $("#btnMindTextSave").disabled = false; }
}
function backFromMind() {
  stopRecordingIfActive();
  if (state.mindReturnScreen === "dayView") { renderDayView(); go("dayView"); }
  else { renderDiary(); go("diary"); }
}
async function deleteMindEntry() {
  if (!confirm("Diesen Eintrag löschen?")) return;
  try {
    const entry = getEntry(state.currentDiaryId, state.currentDate, "mind");
    if (entry && entry.storageKey) invalidateUrl(entry.storageKey);
    await deleteEntry(state.currentDiaryId, state.currentDate, "mind");
    toast("Eintrag gelöscht");
    $("#mindText").value = "";
    resetAudioUi();
    $("#mindExistingWrap").classList.add("hidden");
  } catch (e) { console.error(e); toast("Fehler beim Löschen: " + errMsg(e)); }
}

/* ---- Sprachaufnahme ---- */
function pickAudioMime() {
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}
function resetAudioUi() {
  $("#audioResultWrap").classList.add("hidden");
  $("#recTimer").textContent = "00:00";
  $("#recHint").textContent = IDB_AVAILABLE ? "Tippe zum Aufnehmen" : "Auf diesem Gerät nicht verfügbar";
  $("#btnRecToggle").classList.remove("on");
  state.pendingAudioBlob = null;
  state.recChunks = [];
  state.recSeconds = 0;
  clearInterval(state.recTimerInterval);
}
function showExistingAudio(entry) {
  blobUrlFor(entry.storageKey).then((url) => {
    if (!url) return;
    $("#audioPlayback").src = url;
    $("#audioResultWrap").classList.remove("hidden");
  });
}
async function toggleRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    state.mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.mediaStream = stream;
    const mime = pickAudioMime();
    state.pendingAudioMime = mime;
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    state.mediaRecorder = rec;
    state.recChunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) state.recChunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(state.recTimerInterval);
      const blob = new Blob(state.recChunks, { type: state.pendingAudioMime || "audio/webm" });
      state.pendingAudioBlob = blob;
      $("#audioPlayback").src = URL.createObjectURL(blob);
      $("#audioResultWrap").classList.remove("hidden");
      $("#btnRecToggle").classList.remove("on");
      $("#recHint").textContent = "Tippe zum Aufnehmen";
    };
    rec.onerror = (e) => { console.error(e); toast("Aufnahmefehler: " + errMsg(e.error)); };
    rec.start();
    state.recSeconds = 0;
    $("#recTimer").textContent = "00:00";
    $("#btnRecToggle").classList.add("on");
    $("#recHint").textContent = "Aufnahme läuft…";
    $("#audioResultWrap").classList.add("hidden");
    state.recTimerInterval = setInterval(() => {
      state.recSeconds++;
      $("#recTimer").textContent = `${pad(Math.floor(state.recSeconds / 60))}:${pad(state.recSeconds % 60)}`;
    }, 1000);
  } catch (e) {
    console.error(e);
    toast("Mikrofonzugriff nicht möglich: " + errMsg(e));
  }
}
function stopRecordingIfActive() {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    try { state.mediaRecorder.stop(); } catch {}
  }
  if (state.mediaStream) { state.mediaStream.getTracks().forEach((t) => t.stop()); }
  clearInterval(state.recTimerInterval);
}
async function saveMindAudio() {
  if (!state.pendingAudioBlob) return;
  const { currentDiaryId: diaryId, currentDate: date } = state;
  const key = storageKeyFor(diaryId, date, "mind", "audio");
  $("#btnMindAudioSave").disabled = true;
  try {
    await idbPut(key, state.pendingAudioBlob);
    invalidateUrl(key);
    await upsertEntry(diaryId, date, "mind", { kind: "audio", storageKey: key, text: null });
    toast("Sprachnachricht gespeichert");
    backFromMind();
  } catch (e) {
    console.error(e);
    toast("Fehler beim Speichern: " + errMsg(e));
  } finally { $("#btnMindAudioSave").disabled = false; }
}
function redoAudio() { resetAudioUi(); }

/* ============================================================
   Tages-Ansicht
   ============================================================ */
function openDayView(diaryId, date) {
  state.currentDiaryId = diaryId; state.currentDate = date;
  renderDayView();
  go("dayView");
}
function renderDayView() {
  const diary = getDiary(state.currentDiaryId);
  if (!diary) return go("home");
  const date = state.currentDate;
  $("#dayViewTitle").textContent = dayLabelLong(date);
  const content = $("#dayViewContent");
  content.innerHTML = "";
  diary.blocks.forEach((b) => content.appendChild(dayBlockCard(diary, date, b)));
}
function dayBlockCard(diary, date, blockId) {
  const meta = BLOCKS[blockId];
  const entry = getEntry(diary.id, date, blockId);
  const card = document.createElement("div");
  card.className = "dayblock";
  const header = document.createElement("div");
  header.className = "sec";
  header.innerHTML = `<div class="dayblock-h"><div class="row-glyph sm" style="background:${meta.accent}">${icon(meta.icon)}</div><h2>${meta.name}</h2></div>`;
  const editBtn = document.createElement("button");
  editBtn.className = "btn-text";
  editBtn.textContent = entry ? "Bearbeiten" : "Hinzufügen";
  editBtn.onclick = () => {
    if (meta.kind === "photo") { state.photoReturnScreen = "dayView"; openPhotoEntry(diary.id, date, blockId); }
    else { state.mindReturnScreen = "dayView"; openMindEntry(diary.id, date); }
  };
  header.appendChild(editBtn);
  card.appendChild(header);

  if (!entry) {
    const p = document.createElement("p");
    p.className = "txt muted";
    p.textContent = "Noch kein Eintrag für diesen Tag.";
    card.appendChild(p);
    return card;
  }
  if (entry.kind === "photo") {
    const img = document.createElement("img");
    blobUrlFor(entry.storageKey).then((url) => { if (url) img.src = url; });
    card.appendChild(img);
  } else if (entry.kind === "text") {
    const p = document.createElement("p");
    p.className = "txt";
    p.textContent = entry.text;
    card.appendChild(p);
  } else if (entry.kind === "audio") {
    const audio = document.createElement("audio");
    audio.controls = true;
    blobUrlFor(entry.storageKey).then((url) => { if (url) audio.src = url; });
    card.appendChild(audio);
  }
  return card;
}

/* ============================================================
   UI wiring / Init
   ============================================================ */
function wireEvents() {
  $$("[data-go]").forEach((el) => (el.onclick = () => {
    const target = el.dataset.go;
    go(target);
    if (target === "home") renderHome();
    else if (target === "diary") renderDiary();
  }));

  $("#btnStart").onclick = () => { if (state.diaries.length) { renderHome(); go("home"); } else showCreateDiary(); };
  $("#fabNewDiary").onclick = showCreateDiary;
  $("#dName").oninput = updateCreateSubmit;
  $("#dSubmit").onclick = createDiary;

  $("#btnDiarySettings").onclick = openDiarySheet;
  $("#sheetCancel").onclick = closeDiarySheet;
  $("#sheetRename").onclick = renameDiary;
  $("#sheetDelete").onclick = removeDiaryFlow;
  $("#diarySheet").addEventListener("click", (e) => { if (e.target.id === "diarySheet") closeDiarySheet(); });

  $("#btnPhotoCam").onclick = () => $("#fileCam").click();
  $("#btnPhotoGal").onclick = () => $("#fileGal").click();
  $("#fileCam").onchange = (e) => onPhotoFilePicked(e.target.files[0]);
  $("#fileGal").onchange = (e) => onPhotoFilePicked(e.target.files[0]);
  $("#btnPhotoSave").onclick = savePhoto;
  $("#btnPhotoRetake").onclick = () => { $("#photoChoice").classList.remove("hidden"); $("#photoUpload").classList.add("hidden"); $("#photoSaveBar").classList.add("hidden"); };
  $("#btnPhotoDelete").onclick = deletePhotoEntry;
  $("#btnPhotoBack").onclick = backFromPhoto;

  $$(".tab").forEach((t) => (t.onclick = () => switchMindTab(t.dataset.tab)));
  $("#btnMindTextSave").onclick = saveMindText;
  $("#btnRecToggle").onclick = toggleRecording;
  $("#btnMindAudioSave").onclick = saveMindAudio;
  $("#btnAudioRedo").onclick = redoAudio;
  $("#btnMindDelete").onclick = deleteMindEntry;
  $("#btnMindBack").onclick = backFromMind;
}

function renderStaticIcons() {
  $$("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
}

function registerSW() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

function init() {
  state.diaries = loadDiaries();
  state.entries = loadEntries();
  renderStaticIcons();
  wireEvents();
  registerSW();
  if (state.diaries.length > 0) { renderHome(); go("home"); }
}

init();
