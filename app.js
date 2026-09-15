/* ============================================================
   Mosaik - App-Logik
   Alles läuft rein lokal auf dem Gerät (IndexedDB + localStorage).
   Keine Server, kein Konto, keine Cloud - wichtig bei Gesichts-
   und Körperfotos.
   ============================================================ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const BLOCKS = {
  face: { id: "face", name: "Gesicht", desc: "Tägliches Foto deines Gesichts", icon: "🧑", kind: "photo" },
  body: { id: "body", name: "Körper", desc: "Tägliches Foto deines Körpers", icon: "🏋️", kind: "photo" },
  mind: { id: "mind", name: "Mentale Gesundheit", desc: "Text oder Sprachnachricht", icon: "🧠", kind: "mind" },
};
const BLOCK_ORDER = ["face", "body", "mind"];
const COLORS = ["#0f8b7f", "#3b6fd1", "#8b5cf6", "#e0623f", "#c2477a", "#5a8f29"];

const LS_DIARIES = "mosaik_diaries";
const LS_ENTRIES = "mosaik_entries";

let state = {
  diaries: [],
  entries: [],
  currentDiaryId: null,
  currentDate: null,
  currentBlock: null,
  newDiaryColor: COLORS[0],
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
  toast._t = setTimeout(() => t.classList.remove("on"), 2600);
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

/* ---------- IndexedDB (Foto- / Audio-Blobs) ---------- */
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("mosaik", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(key, val) {
  const d = await idbOpen();
  return new Promise((res, rej) => {
    const tx = d.transaction("files", "readwrite");
    tx.objectStore("files").put(val, key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const d = await idbOpen();
  return new Promise((res, rej) => {
    const tx = d.transaction("files", "readonly");
    const rq = tx.objectStore("files").get(key);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
async function idbDelete(key) {
  const d = await idbOpen();
  return new Promise((res, rej) => {
    const tx = d.transaction("files", "readwrite");
    tx.objectStore("files").delete(key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
const urlCache = new Map();
async function blobUrlFor(key) {
  if (!key) return "";
  if (urlCache.has(key)) return urlCache.get(key);
  const blob = await idbGet(key);
  const url = blob ? URL.createObjectURL(blob) : "";
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
  $("#homeDate").textContent = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  const list = $("#diaryList");
  list.innerHTML = "";
  $("#homeEmpty").classList.toggle("hidden", state.diaries.length > 0);
  state.diaries.forEach((diary) => list.appendChild(diaryCard(diary)));
}

function diaryCard(diary) {
  const wrap = document.createElement("div");
  wrap.className = "diary-card";
  const icon = diary.blocks.length === 1 ? BLOCKS[diary.blocks[0]].icon : "🧩";
  const streak = computeStreak(diary);
  const done = todayDoneCount(diary);
  const meta = diary.blocks.map((b) => BLOCKS[b].name).join(" · ");
  wrap.innerHTML = `
    <div class="swatch" style="background:${diary.color}">${icon}</div>
    <div class="info">
      <div class="name">${escapeHtml(diary.name)}</div>
      <div class="meta">${streak > 0 ? "🔥 " + streak + (streak === 1 ? " Tag · " : " Tage · ") : ""}${escapeHtml(meta)}</div>
      <div class="prog">${diary.blocks.map((b) => `<span class="${getEntry(diary.id, todayKey(), b) ? "done" : ""}"></span>`).join("")}</div>
    </div>
    <div class="chev">›</div>`;
  wrap.onclick = () => openDiary(diary.id);
  return wrap;
}

/* ============================================================
   Tagebuch erstellen
   ============================================================ */
function showCreateDiary() {
  state.newDiaryColor = COLORS[0];
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
  COLORS.forEach((c, i) => {
    const b = document.createElement("button");
    b.style.background = c;
    if (i === 0) b.classList.add("on");
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
    el.innerHTML = `<div class="e">${b.icon}</div><div class="t"><div class="n">${b.name}</div><div class="d">${b.desc}</div></div><div class="check">✓</div>`;
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
  toast("Tagebuch erstellt 🎉");
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
  $("#diaryStreak").textContent = streak > 0 ? `🔥 ${streak} ${streak === 1 ? "Tag" : "Tage"}` : "✨ Leg los";
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
  row.className = "today-block" + (entry ? " done" : "");
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  thumb.textContent = meta.icon;
  row.appendChild(thumb);
  if (entry && entry.kind === "photo" && entry.storageKey) {
    blobUrlFor(entry.storageKey).then((url) => {
      if (!url) return;
      thumb.innerHTML = "";
      const img = document.createElement("img");
      img.src = url; thumb.appendChild(img);
    });
  }
  const info = document.createElement("div");
  info.className = "info";
  let sub = meta.desc;
  if (entry) {
    if (entry.kind === "text") sub = "Eintrag: " + (entry.text.length > 40 ? entry.text.slice(0, 40) + "…" : entry.text);
    else if (entry.kind === "audio") sub = "🎙️ Sprachnachricht gespeichert";
    else if (entry.kind === "photo") sub = "Foto gespeichert";
  }
  info.innerHTML = `<div class="n">${meta.name}</div><div class="d">${escapeHtml(sub)}</div>`;
  row.appendChild(info);
  const status = document.createElement("div");
  status.className = "status";
  status.textContent = entry ? "✅" : "➕";
  row.appendChild(status);
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
  cell.className = "daycell" + (anyEntry ? "" : " empty-day");
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
  await deleteDiary(diary.id);
  toast("Tagebuch gelöscht");
  go("home"); renderHome();
}

/* ============================================================
   Foto-Eintrag
   ============================================================ */
function openPhotoEntry(diaryId, date, block) {
  state.currentDiaryId = diaryId; state.currentDate = date; state.currentBlock = block;
  state.pendingPhotoFile = null;
  $("#photoTitle").textContent = BLOCKS[block].name;
  $("#photoPill").textContent = "📸 " + dayLabelFor(date).toUpperCase();
  $("#photoPrompt").textContent = BLOCKS[block].name + " festhalten";
  $("#photoChoice").classList.remove("hidden");
  $("#photoUpload").classList.add("hidden");
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
    toast("Foto gespeichert ✅");
    backFromPhoto();
  } catch (e) { console.error(e); toast("Fehler beim Speichern"); }
  finally { $("#btnPhotoSave").disabled = false; }
}
async function deletePhotoEntry() {
  const { currentDiaryId: diaryId, currentDate: date, currentBlock: block } = state;
  if (!confirm("Diesen Eintrag löschen?")) return;
  const entry = getEntry(diaryId, date, block);
  if (entry && entry.storageKey) invalidateUrl(entry.storageKey);
  await deleteEntry(diaryId, date, block);
  toast("Eintrag gelöscht");
  refreshExistingPhoto();
  if (state.photoReturnScreen === "diary") renderDiary();
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
  $("#mindTitle").textContent = "Mentale Gesundheit — " + dayLabelFor(date);
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
}
async function saveMindText() {
  const text = $("#mindText").value.trim();
  if (!text) return toast("Bitte etwas schreiben");
  await upsertEntry(state.currentDiaryId, state.currentDate, "mind", { kind: "text", text, storageKey: null });
  toast("Gespeichert ✅");
  backFromMind();
}
function backFromMind() {
  stopRecordingIfActive();
  if (state.mindReturnScreen === "dayView") { renderDayView(); go("dayView"); }
  else { renderDiary(); go("diary"); }
}
async function deleteMindEntry() {
  if (!confirm("Diesen Eintrag löschen?")) return;
  const entry = getEntry(state.currentDiaryId, state.currentDate, "mind");
  if (entry && entry.storageKey) invalidateUrl(entry.storageKey);
  await deleteEntry(state.currentDiaryId, state.currentDate, "mind");
  toast("Eintrag gelöscht");
  $("#mindText").value = "";
  resetAudioUi();
  $("#mindExistingWrap").classList.add("hidden");
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
  $("#recHint").textContent = "Tippe zum Aufnehmen";
  $("#btnRecToggle").classList.remove("on");
  $("#recIcon").textContent = "🎙️";
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
      $("#recIcon").textContent = "🎙️";
      $("#recHint").textContent = "Tippe zum Aufnehmen";
    };
    rec.start();
    state.recSeconds = 0;
    $("#recTimer").textContent = "00:00";
    $("#btnRecToggle").classList.add("on");
    $("#recIcon").textContent = "⏹";
    $("#recHint").textContent = "Aufnahme läuft…";
    $("#audioResultWrap").classList.add("hidden");
    state.recTimerInterval = setInterval(() => {
      state.recSeconds++;
      $("#recTimer").textContent = `${pad(Math.floor(state.recSeconds / 60))}:${pad(state.recSeconds % 60)}`;
    }, 1000);
  } catch (e) {
    console.error(e);
    toast("Mikrofonzugriff nicht möglich");
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
  try {
    await idbPut(key, state.pendingAudioBlob);
    invalidateUrl(key);
    await upsertEntry(diaryId, date, "mind", { kind: "audio", storageKey: key, text: null });
    toast("Sprachnachricht gespeichert ✅");
    backFromMind();
  } catch (e) { console.error(e); toast("Fehler beim Speichern"); }
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
  header.innerHTML = `<h2>${meta.icon} ${meta.name}</h2>`;
  const editBtn = document.createElement("button");
  editBtn.className = "btn ghost sm";
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
  $("#btnPhotoRetake").onclick = () => { $("#photoChoice").classList.remove("hidden"); $("#photoUpload").classList.add("hidden"); };
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

function registerSW() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

function init() {
  state.diaries = loadDiaries();
  state.entries = loadEntries();
  wireEvents();
  registerSW();
  if (state.diaries.length > 0) { renderHome(); go("home"); }
}

init();
