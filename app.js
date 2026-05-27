/* ============================================================
   Tripp - App-Logik
   Zwei Backends hinter EINER db-Schnittstelle:
   - Supabase (echtes Teilen) wenn config.js ausgefüllt ist
   - Lokaler Demo-Modus (IndexedDB + localStorage) sonst,
     damit man die App sofort ohne Setup testen kann.
   ============================================================ */

const CFG = window.TRIPP_CONFIG || {};
const CONFIGURED =
  CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
  !CFG.SUPABASE_URL.includes("DEINE_") && !CFG.SUPABASE_ANON_KEY.includes("DEIN_");

/* ---------- Helpers ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const EMOJIS = ["🦊","🐨","🐧","🐱","🐶","🦁","🐼","🐸","🐵","🦄","🐯","🐮","🦉","🐙","🦖","😎","🥳","👑"];
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SESSION_KEY = "tripp_session";

let state = { trip: null, members: [], clips: [], pendingTrip: null, selectedEmoji: EMOJIS[0] };
let db = null; // wird in init() gesetzt

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
function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function randomCode(n = 5) {
  let c = ""; for (let i = 0; i < n; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return c;
}
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2)); }
function shareLink(code) { return location.origin + location.pathname + "#join=" + code; }
function fileExt(file) {
  const m = (file.name || "").match(/\.([a-z0-9]+)$/i);
  if (m) return m[1].toLowerCase();
  if ((file.type || "").includes("quicktime")) return "mov";
  return "mp4";
}
function dayLabel(trip) {
  if (trip && trip.start_date) {
    const start = new Date(trip.start_date + "T00:00:00");
    const diff = Math.floor((Date.now() - start.getTime()) / 86400000) + 1;
    if (diff >= 1) return "Tag " + diff;
  }
  return new Date().toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }

/* ---------- URL-Cache (Supabase: public URL, lokal: object URL) ---------- */
const urlCache = new Map();
async function ensureUrl(path) {
  if (!urlCache.has(path)) urlCache.set(path, await db.fileUrl(path));
  return urlCache.get(path);
}
function urlFor(path) { return urlCache.get(path) || ""; }

/* ============================================================
   Lokales Demo-Backend (IndexedDB für Videos, localStorage für Daten)
   ============================================================ */
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("tripp", 1);
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
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
const T_TRIPS = "tripp_l_trips", T_MEM = "tripp_l_members", T_CLIPS = "tripp_l_clips";

const LocalBackend = {
  async getTripByCode(code) { return LS.get(T_TRIPS).find((t) => t.code === code) || null; },
  async getTrip(id) { return LS.get(T_TRIPS).find((t) => t.id === id) || null; },
  async createTrip(f) {
    const trips = LS.get(T_TRIPS);
    let code; do { code = randomCode(); } while (trips.some((t) => t.code === code));
    const trip = { id: uid(), code, created_at: new Date().toISOString(), ...f };
    trips.push(trip); LS.set(T_TRIPS, trips); return trip;
  },
  async addMember(m) {
    const a = LS.get(T_MEM); const mem = { id: uid(), created_at: new Date().toISOString(), ...m };
    a.push(mem); LS.set(T_MEM, a); return mem;
  },
  async getMembers(tripId) {
    return LS.get(T_MEM).filter((m) => m.trip_id === tripId).sort((x, y) => x.created_at.localeCompare(y.created_at));
  },
  async addClip(c) {
    const a = LS.get(T_CLIPS); const clip = { id: uid(), reactions: 0, created_at: new Date().toISOString(), ...c };
    a.push(clip); LS.set(T_CLIPS, a); return clip;
  },
  async getClips(tripId) {
    return LS.get(T_CLIPS).filter((c) => c.trip_id === tripId).sort((x, y) => x.created_at.localeCompare(y.created_at));
  },
  async addReaction(id, newCount) {
    const a = LS.get(T_CLIPS); const c = a.find((x) => x.id === id);
    if (c) { c.reactions = newCount; LS.set(T_CLIPS, a); }
  },
  async uploadFile(path, file) { await idbPut(path, file); },
  async fileUrl(path) { const b = await idbGet(path); return b ? URL.createObjectURL(b) : ""; },
};

/* ============================================================
   Supabase-Backend
   ============================================================ */
function makeSupabaseBackend(sb) {
  return {
    async getTripByCode(code) {
      const { data } = await sb.from("trips").select("*").eq("code", code).maybeSingle();
      return data || null;
    },
    async getTrip(id) {
      const { data } = await sb.from("trips").select("*").eq("id", id).maybeSingle();
      return data || null;
    },
    async createTrip(f) {
      for (let i = 0; i < 6; i++) {
        const code = randomCode();
        const { data, error } = await sb.from("trips").insert({ code, ...f }).select().single();
        if (!error) return data;
        if (error.code !== "23505") throw error; // 23505 = unique violation -> neuer Code
      }
      throw new Error("Konnte keinen eindeutigen Code erzeugen");
    },
    async addMember(m) {
      const { data, error } = await sb.from("members").insert(m).select().single();
      if (error) throw error; return data;
    },
    async getMembers(tripId) {
      const { data } = await sb.from("members").select("*").eq("trip_id", tripId).order("created_at");
      return data || [];
    },
    async addClip(c) {
      const { data, error } = await sb.from("clips").insert(c).select().single();
      if (error) throw error; return data;
    },
    async getClips(tripId) {
      const { data } = await sb.from("clips").select("*").eq("trip_id", tripId).order("created_at");
      return data || [];
    },
    async addReaction(id, newCount) {
      const { error } = await sb.rpc("add_reaction", { clip_id: id });
      if (error) await sb.from("clips").update({ reactions: newCount }).eq("id", id);
    },
    async uploadFile(path, file) {
      const { error } = await sb.storage.from("clips").upload(path, file, {
        contentType: file.type || "video/mp4", upsert: false,
      });
      if (error) throw error;
    },
    async fileUrl(path) { return sb.storage.from("clips").getPublicUrl(path).data.publicUrl; },
  };
}

/* ============================================================
   Init / Routing
   ============================================================ */
async function init() {
  buildEmojiGrid();
  wireEvents();
  registerSW();

  if (CONFIGURED) {
    const mod = await import("https://esm.sh/@supabase/supabase-js@2");
    db = makeSupabaseBackend(mod.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY));
  } else {
    db = LocalBackend;
    showDemoBanner();
  }
  await route();
}

function showDemoBanner() {
  const b = document.createElement("div");
  b.className = "banner";
  b.innerHTML =
    "🧪 <b>Demo-Modus.</b> Die App läuft lokal auf diesem Gerät — du kannst alles ausprobieren, " +
    "aber Clips werden noch nicht mit Freunden geteilt. Für echtes Teilen: <code>config.js</code> ausfüllen (siehe <code>SETUP.md</code>).";
  $("#landing .scroll").prepend(b);
}

async function route() {
  const m = (location.hash || "").match(/join=([A-Za-z0-9]+)/);
  const joinCode = m ? m[1].toUpperCase() : null;
  const session = loadSession();

  try {
    if (joinCode) {
      if (session && session.code === joinCode && (await enterTrip(session.tripId))) return;
      const trip = await db.getTripByCode(joinCode);
      if (trip) { startProfile(trip); return; }
      toast("Trip-Code nicht gefunden");
    }
    if (session && session.tripId) {
      if (await enterTrip(session.tripId)) return;
      clearSession();
    }
  } catch (e) { console.error(e); }
  go("landing");
}

/* ============================================================
   Flows
   ============================================================ */
async function createTrip() {
  const name = $("#cName").value.trim();
  if (!name) return toast("Bitte gib einen Trip-Namen ein");
  const f = {
    name,
    destination: $("#cDest").value.trim() || null,
    start_date: $("#cStart").value || null,
    end_date: $("#cEnd").value || null,
  };
  $("#cSubmit").disabled = true;
  try {
    const trip = await db.createTrip(f);
    startProfile(trip);
  } catch (e) { console.error(e); toast("Fehler beim Anlegen: " + (e.message || e)); }
  finally { $("#cSubmit").disabled = false; }
}

async function joinTrip() {
  const code = $("#jCode").value.trim().toUpperCase();
  if (!code) return toast("Bitte Code eingeben");
  $("#jSubmit").disabled = true;
  try {
    const trip = await db.getTripByCode(code);
    if (!trip) return toast("Kein Trip mit diesem Code gefunden");
    startProfile(trip);
  } catch (e) { console.error(e); toast("Fehler: " + (e.message || e)); }
  finally { $("#jSubmit").disabled = false; }
}

function startProfile(trip) {
  state.pendingTrip = trip;
  $("#pTripName").textContent = trip.name;
  $("#pName").value = "";
  go("profile");
}

async function saveProfile() {
  const name = $("#pName").value.trim();
  if (!name) return toast("Bitte gib deinen Namen ein");
  const trip = state.pendingTrip;
  $("#pSubmit").disabled = true;
  try {
    await db.addMember({ trip_id: trip.id, name, emoji: state.selectedEmoji });
    saveSession({ tripId: trip.id, code: trip.code, name, emoji: state.selectedEmoji });
    await enterTrip(trip.id);
  } catch (e) { console.error(e); toast("Fehler: " + (e.message || e)); }
  finally { $("#pSubmit").disabled = false; }
}

async function enterTrip(tripId) {
  const trip = await db.getTrip(tripId);
  if (!trip) return false;
  state.trip = trip;
  state.members = await db.getMembers(tripId);
  await loadClips();
  renderFeed();
  go("feed");
  return true;
}

async function loadClips() {
  state.clips = await db.getClips(state.trip.id);
  await Promise.all(state.clips.map((c) => ensureUrl(c.storage_path).catch(() => {})));
}

/* ============================================================
   Feed
   ============================================================ */
const CHALLENGES = ["den Sonnenuntergang 🌅","das beste Essen 🍽️","ein Gruppen-Selfie 🤳","die schönste Aussicht 🏞️","euren Lieblingsmoment ✨","etwas Lustiges 😂"];
function todaysChallenge() {
  const seed = (state.trip ? state.trip.code.length + new Date().getDate() : 0) % CHALLENGES.length;
  return CHALLENGES[seed];
}

function renderFeed() {
  const t = state.trip;
  $("#feedTitle").textContent = t.name;
  $("#feedDay").textContent = (t.destination ? t.destination.toUpperCase() + " · " : "") + dayLabel(t);
  $("#shareCode").textContent = t.code;
  $("#capChallenge").textContent = todaysChallenge();
  $("#challengeText").textContent = "Fang ein: " + todaysChallenge();

  const av = $("#feedAvatars"); av.innerHTML = "";
  state.members.slice(0, 4).forEach((m) => {
    const d = document.createElement("div"); d.className = "av"; d.textContent = m.emoji || "🙂"; av.appendChild(d);
  });
  if (state.members.length > 4) {
    const d = document.createElement("div");
    d.className = "av"; d.style.background = "#1a1530"; d.style.color = "#fff"; d.style.fontSize = "12px";
    d.textContent = "+" + (state.members.length - 4); av.appendChild(d);
  }
  renderClips();
}

function renderClips() {
  const grid = $("#clipGrid"); grid.innerHTML = "";
  $("#feedEmpty").classList.toggle("hidden", state.clips.length > 0);
  state.clips.slice().reverse().forEach((c) => grid.appendChild(clipCard(c)));
}

function clipCard(c) {
  const wrap = document.createElement("div");
  wrap.className = "clip";
  const v = document.createElement("video");
  v.src = urlFor(c.storage_path);
  v.preload = "metadata"; v.playsInline = true; v.muted = true;
  v.addEventListener("loadeddata", () => { try { v.currentTime = 0.4; } catch {} }, { once: true });
  wrap.appendChild(v);

  const playIc = document.createElement("div");
  playIc.className = "play-ic"; playIc.textContent = "▶"; wrap.appendChild(playIc);

  const ov = document.createElement("div"); ov.className = "ov";
  const react = document.createElement("button");
  react.className = "react"; react.innerHTML = "❤️ " + (c.reactions || 0);
  react.onclick = (e) => { e.stopPropagation(); reactTo(c, react); };
  const meta = document.createElement("div"); meta.className = "meta";
  meta.textContent = (c.member_emoji || "🙂") + " " + (c.member_name || "?") +
    (c.day_label ? " · " + c.day_label : "") + (c.caption ? " · " + c.caption : "");
  ov.appendChild(react); ov.appendChild(meta); wrap.appendChild(ov);

  wrap.onclick = () => {
    if (v.paused) { v.muted = false; v.controls = true; v.play(); playIc.style.display = "none"; }
    else { v.pause(); playIc.style.display = "grid"; }
  };
  return wrap;
}

async function reactTo(clip, btn) {
  clip.reactions = (clip.reactions || 0) + 1;
  btn.innerHTML = "❤️ " + clip.reactions;
  try { await db.addReaction(clip.id, clip.reactions); } catch (e) { console.error(e); }
}

/* ============================================================
   Capture / Upload
   ============================================================ */
let pendingFile = null;
function showCapture() {
  pendingFile = null;
  $("#captureChoice").classList.remove("hidden");
  $("#captureUpload").classList.add("hidden");
  $("#capCaption").value = "";
  $("#capBar").classList.add("hidden");
  $("#capBar").querySelector("i").style.width = "0%";
  $("#fileCam").value = ""; $("#fileGal").value = "";
  go("capture");
}
function onFilePicked(file) {
  if (!file) return;
  pendingFile = file;
  $("#capPreview").src = URL.createObjectURL(file);
  $("#captureChoice").classList.add("hidden");
  $("#captureUpload").classList.remove("hidden");
}
async function uploadClip() {
  if (!pendingFile) return;
  const session = loadSession();
  const path = `${state.trip.id}/${Date.now()}_${randomCode(4)}.${fileExt(pendingFile)}`;
  const bar = $("#capBar"); const fill = bar.querySelector("i");
  bar.classList.remove("hidden");
  $("#btnUpload").disabled = true;

  let pct = 8; fill.style.width = pct + "%";
  const tick = setInterval(() => { pct = Math.min(90, pct + 6); fill.style.width = pct + "%"; }, 350);
  try {
    await db.uploadFile(path, pendingFile);
    clearInterval(tick); fill.style.width = "100%";
    urlCache.set(path, await db.fileUrl(path));
    await db.addClip({
      trip_id: state.trip.id,
      member_name: session ? session.name : null,
      member_emoji: session ? session.emoji : null,
      storage_path: path,
      caption: $("#capCaption").value.trim() || null,
      day_label: dayLabel(state.trip),
    });
    await loadClips(); renderClips();
    toast("Clip geteilt! 🎬");
    go("feed");
  } catch (e) {
    clearInterval(tick); fill.style.width = "0%";
    console.error(e); toast("Upload fehlgeschlagen: " + (e.message || e));
  } finally { $("#btnUpload").disabled = false; }
}

/* ============================================================
   Teilen / Wechseln
   ============================================================ */
async function shareTrip() {
  const t = state.trip; const link = shareLink(t.code);
  const text = `🎬 Wir drehen ein Reise-Video von "${t.name}" auf Tripp – sei dabei!\nCode: ${t.code}\n${link}`;
  if (navigator.share) { try { await navigator.share({ title: "Tripp", text, url: link }); return; } catch {} }
  try { await navigator.clipboard.writeText(link); toast("Einladungs-Link kopiert 📋"); }
  catch { toast("Code: " + t.code); }
}
function leaveTrip() {
  if (!confirm("Trip verlassen / wechseln? Deine Clips bleiben gespeichert.")) return;
  clearSession();
  state = { trip: null, members: [], clips: [], pendingTrip: null, selectedEmoji: EMOJIS[0] };
  location.hash = "";
  go("landing");
}

/* ============================================================
   Recap-Player
   ============================================================ */
function openRecap() {
  if (!state.clips.length) return toast("Noch keine Clips für ein Recap");
  $("#recapTitle").textContent = state.trip.name;
  $("#recapInfo").textContent = `${state.clips.length} Clips · ${state.members.length} Reisende`;
  go("recap");
}

let recapIdx = 0, recapAudio = null, recapList = [];
function playRecap() {
  recapList = state.clips.slice();
  if (!recapList.length) return toast("Keine Clips");
  recapIdx = 0;
  $("#playerWrap").classList.add("on");
  $("#recapEndCard").classList.add("hide");

  const prog = $("#playerProgress"); prog.innerHTML = "";
  recapList.forEach(() => { const seg = document.createElement("div"); seg.className = "seg"; seg.innerHTML = "<i></i>"; prog.appendChild(seg); });

  if (recapAudio) { recapAudio.pause(); recapAudio = null; }
  if ($("#swMusic").classList.contains("on")) {
    recapAudio = new Audio("assets/music.mp3");
    recapAudio.loop = true; recapAudio.volume = 0.6;
    recapAudio.play().catch(() => { recapAudio = null; });
  }

  const tc = $("#recapTitleCard");
  if ($("#swTitle").classList.contains("on")) {
    $("#tcName").textContent = state.trip.name;
    $("#tcSub").textContent = (state.trip.destination || "") +
      (state.trip.start_date ? " · " + new Date(state.trip.start_date).getFullYear() : "");
    tc.classList.remove("hide");
    setTimeout(() => { tc.classList.add("hide"); startClip(0); }, 2600);
  } else { tc.classList.add("hide"); startClip(0); }
}

function startClip(i) {
  if (i >= recapList.length) return endRecap();
  recapIdx = i;
  const c = recapList[i];
  const v = $("#recapVideo");
  v.src = urlFor(c.storage_path);
  v.muted = !!recapAudio;
  v.currentTime = 0;
  // Falls iOS Autoplay mit Ton blockt: stumm weiterlaufen statt hängen.
  v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });

  $("#recapLabel").innerHTML =
    `<div class="muted" style="color:rgba(255,255,255,.85);font-weight:700">${(c.member_emoji||"🙂")} ${escapeHtml(c.member_name)} ${c.day_label ? ("· " + c.day_label) : ""}</div>` +
    (c.caption ? `<h2>${escapeHtml(c.caption)}</h2>` : "");

  $$("#playerProgress .seg").forEach((seg, idx) => {
    seg.classList.toggle("done", idx < i);
    seg.querySelector("i").style.width = idx < i ? "100%" : "0%";
  });
}

function endRecap() {
  $$("#playerProgress .seg").forEach((seg) => { seg.classList.add("done"); seg.querySelector("i").style.width = "100%"; });
  const v = $("#recapVideo"); v.pause();
  if (recapAudio) { recapAudio.pause(); recapAudio = null; }
  const days = dayLabel(state.trip);
  $("#endStats").textContent = `${state.clips.length} Clips · ${state.members.length} Reisende${days ? " · " + days : ""}`;
  $("#recapEndCard").classList.remove("hide");
}
function closeRecap() {
  const v = $("#recapVideo"); v.pause(); v.removeAttribute("src"); v.load();
  if (recapAudio) { recapAudio.pause(); recapAudio = null; }
  $("#recapEndCard").classList.add("hide");
  $("#playerWrap").classList.remove("on");
}
function togglePause() {
  const v = $("#recapVideo");
  if (v.paused) { v.play(); if (recapAudio) recapAudio.play().catch(() => {}); $("#playerPause").textContent = "⏸"; }
  else { v.pause(); if (recapAudio) recapAudio.pause(); $("#playerPause").textContent = "▶"; }
}

/* ============================================================
   UI wiring
   ============================================================ */
function buildEmojiGrid() {
  const grid = $("#emojiGrid");
  EMOJIS.forEach((e, i) => {
    const b = document.createElement("button");
    b.textContent = e; if (i === 0) b.classList.add("on");
    b.onclick = () => {
      state.selectedEmoji = e;
      $$("#emojiGrid button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    };
    grid.appendChild(b);
  });
}

function wireEvents() {
  $$("[data-go]").forEach((el) => (el.onclick = () => go(el.dataset.go)));

  $("#btnCreate").onclick = () => {
    const today = new Date().toISOString().slice(0, 10);
    const wk = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    $("#cStart").value = today; $("#cEnd").value = wk;
    go("create");
  };
  $("#btnJoin").onclick = () => go("join");
  $("#cSubmit").onclick = createTrip;
  $("#jSubmit").onclick = joinTrip;
  $("#pSubmit").onclick = saveProfile;

  $("#fab").onclick = showCapture;
  $("#btnRecord").onclick = () => $("#fileCam").click();
  $("#btnGallery").onclick = () => $("#fileGal").click();
  $("#fileCam").onchange = (e) => onFilePicked(e.target.files[0]);
  $("#fileGal").onchange = (e) => onFilePicked(e.target.files[0]);
  $("#btnUpload").onclick = uploadClip;
  $("#btnRetake").onclick = showCapture;

  $("#btnRefresh").onclick = async () => { await loadClips(); renderClips(); toast("Aktualisiert"); };
  $("#btnRecap").onclick = openRecap;
  $("#navRecap").onclick = openRecap;
  $("#btnShare").onclick = shareTrip;
  $("#navShare").onclick = shareTrip;
  $("#navLeave").onclick = leaveTrip;

  $("#btnPlayRecap").onclick = playRecap;
  $("#playerClose").onclick = closeRecap;
  $("#playerPause").onclick = togglePause;
  $("#btnShareRecap").onclick = shareTrip;
  $("#btnReplayRecap").onclick = playRecap;
  $("#btnCloseEnd").onclick = closeRecap;
  $("#recapVideo").addEventListener("ended", () => startClip(recapIdx + 1));

  $("#swMusic").onclick = () => $("#swMusic").classList.toggle("on");
  $("#swTitle").onclick = () => $("#swTitle").classList.toggle("on");
}

function registerSW() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
