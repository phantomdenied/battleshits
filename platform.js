// platform.js — game-agnostic party-game platform.
// Rooms, anonymous auth, presence, seats/roles, reconnect-by-name, the action
// queue (phones -> host), server clock, plus small device helpers (wake lock,
// no-zoom, TV D-pad spatial navigation, QR). Knows nothing about Battleship.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getDatabase, ref, set, update, remove, get, onValue, onChildAdded, onChildChanged,
  onDisconnect, serverTimestamp, runTransaction, query, orderByValue, endAt,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

export const VERSION = "0.1.0";
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O (and no digits at all)
export const SEATS = ["p1", "p2"];
const ROOM_TTL = 24 * 3600 * 1000;
const STALE_MS = 45000;
const HEARTBEAT_MS = 15000;
const HOST_KEY = "party.hostRoom";

let db, uid, offset = 0;

export async function boot() {
  if (db) return { db, uid };
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  db = getDatabase(app);
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  uid = auth.currentUser.uid;
  onValue(ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
  return { db, uid };
}

export const now = () => Date.now() + offset;
export const myUid = () => uid;

export function randomCode() {
  let s = "";
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  for (const n of a) s += CODE_ALPHABET[n % CODE_ALPHABET.length];
  return s;
}
export function normalizeCode(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}
export function cleanName(s) {
  return String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 12);
}
export function joinUrl(code) {
  const u = new URL("play.html", location.href);
  u.search = "?room=" + code;
  return u.href;
}
export function isOnline(p, t = now()) {
  return !!p && p.online !== false && (!p.lastSeen || t - p.lastSeen < STALE_MS);
}

/* ------------------------------------------------------------------ host */

async function sweepStaleRooms() {
  const snap = await get(query(ref(db, "roomIndex"), orderByValue(), endAt(now() - ROOM_TTL)));
  const codes = [];
  snap.forEach((c) => { codes.push(c.key); });
  for (const code of codes) {
    try { await remove(ref(db, `rooms/${code}`)); } catch (e) { console.warn("sweep room", code, e.message); }
    try { await remove(ref(db, `roomIndex/${code}`)); } catch (e) { console.warn("sweep index", code, e.message); }
  }
  return codes.length;
}

export async function createRoom({ game, theme, initialState }) {
  await boot();
  await sweepStaleRooms().catch((e) => console.warn("sweep failed", e));
  for (let i = 0; i < 25; i++) {
    const code = randomCode();
    const tx = await runTransaction(ref(db, `roomIndex/${code}`), (cur) => (cur === null ? serverTimestamp() : undefined));
    if (!tx.committed) continue;
    await set(ref(db, `rooms/${code}`), { hostUid: uid, createdAt: serverTimestamp(), game, theme, state: initialState });
    try { localStorage.setItem(HOST_KEY, code); } catch {}
    return code;
  }
  throw new Error("Could not allocate a room code");
}

// TV reload: resume our own room if it still exists and is < 24h old.
export async function resumeHostedRoom() {
  await boot();
  let code = null;
  try { code = localStorage.getItem(HOST_KEY); } catch {}
  if (!code) return null;
  try {
    const [h, c] = await Promise.all([get(ref(db, `rooms/${code}/hostUid`)), get(ref(db, `rooms/${code}/createdAt`))]);
    if (h.val() === uid && now() - (c.val() || 0) < ROOM_TTL) return code;
  } catch (e) { console.warn("resume failed", e); }
  try { localStorage.removeItem(HOST_KEY); } catch {}
  return null;
}

/**
 * HostRoom: the TV's handle on a room. All authority lives here + the game module.
 * events: onState(state), onTheme(id), onPlayers(players), onAction(uid, action), onGone()
 */
export class HostRoom {
  constructor(code, events) {
    this.code = code;
    this.ev = events;
    this.state = null;
    this.secret = {};
    this.players = {};
    this.theme = null;
    this.unsubs = [];
  }
  r(p) { return ref(db, `rooms/${this.code}/${p}`); }

  async open() {
    const [st, sec, th, pl] = await Promise.all([get(this.r("state")), get(this.r("secret")), get(this.r("theme")), get(this.r("players"))]);
    this.state = st.val();
    this.secret = sec.val() || {};
    this.theme = th.val();
    this.players = pl.val() || {};
    this.unsubs.push(onValue(this.r("players"), (s) => {
      this.players = s.val() || {};
      this.reconcilePlayers();
      this.ev.onPlayers?.(this.players);
    }));
    this.unsubs.push(onValue(this.r("hostUid"), (s) => { if (s.val() !== uid) this.ev.onGone?.(); }));
    const onAct = (s) => {
      const a = s.val();
      const from = s.key;
      remove(s.ref).catch(() => {});
      if (!a || !a.type) return;
      if (a.ts && now() - a.ts > 60000) return; // stale action from long ago
      try { this.ev.onAction?.(from, a); } catch (e) { console.error("action failed", e); }
    };
    const lerr = (e) => console.error("actions listener cancelled:", e.message);
    this.unsubs.push(onChildAdded(this.r("actions"), onAct, lerr));
    this.unsubs.push(onChildChanged(this.r("actions"), onAct, lerr));
    // keep presence fresh for STALE checks
    this.hb = setInterval(() => { this.reconcilePlayers(); this.ev.onPlayers?.(this.players); }, 5000);
    return this;
  }

  close() { this.unsubs.forEach((u) => u()); clearInterval(this.hb); }

  setState(s) { this.state = s; return set(this.r("state"), s); }
  setSecret(s) { this.secret = s; return set(this.r("secret"), s); }
  setTheme(id) { this.theme = id; this.ev.onTheme?.(id); return set(this.r("theme"), id); }
  setPrivate(puid, key, val) { return set(this.r(`private/${puid}/${key}`), val ?? null); }
  async getPrivate(puid) { return (await get(this.r(`private/${puid}`))).val(); }

  seatOf(puid) { const r = this.players[puid]?.role; return SEATS.includes(r) ? r : null; }
  uidForSeat(seat) { return Object.keys(this.players).find((k) => this.players[k].role === seat) || null; }
  seatInfo() {
    const out = {};
    for (const s of SEATS) { const u = this.uidForSeat(s); out[s] = u ? { uid: u, name: this.players[u].name } : null; }
    return out;
  }
  isOnline(puid) { return isOnline(this.players[puid]); }

  setRole(puid, role) { return update(this.r(`players/${puid}`), { role }); }
  async kick(puid) {
    await set(this.r(`kicked/${puid}`), true);
    await remove(this.r(`players/${puid}`));
    await remove(this.r(`private/${puid}`));
  }
  // Cycle a player's seat: spectator -> p1 -> p2 -> spectator, swapping with whoever holds it.
  async cycleSeat(puid) {
    const cur = this.players[puid]?.role;
    const order = ["spectator", "p1", "p2"];
    const next = order[(order.indexOf(cur) + 1) % order.length];
    const ups = { [`players/${puid}/role`]: next };
    if (next !== "spectator") {
      const holder = this.uidForSeat(next);
      if (holder && holder !== puid) ups[`players/${holder}/role`] = cur === "spectator" ? "spectator" : cur;
    }
    return update(ref(db, `rooms/${this.code}`), ups);
  }
  async endRoom() {
    try { localStorage.removeItem(HOST_KEY); } catch {}
    this.close();
    await remove(ref(db, `rooms/${this.code}`));
    await remove(ref(db, `roomIndex/${this.code}`)).catch(() => {});
  }

  /** Auto-seat newcomers and reconnect-by-name. Runs on every players change. */
  reconcilePlayers() {
    if (this._reconciling) return;
    const P = this.players;
    const ups = {};
    const transfers = [];
    const ids = Object.keys(P).sort((a, b) => (P[a].joinedAt || 0) - (P[b].joinedAt || 0));
    const taken = new Set(ids.map((k) => P[k].role).filter((r) => SEATS.includes(r)));
    for (const id of ids) {
      const p = P[id];
      if (!p.claimed) {
        // a fresh join: try to match an existing entry with the same name
        const twin = ids.find((o) => o !== id && P[o].claimed && P[o].name.toLowerCase() === p.name.toLowerCase());
        if (twin && !isOnline(P[twin])) {
          ups[`players/${id}/role`] = P[twin].role;
          ups[`players/${id}/claimed`] = true;
          ups[`players/${twin}`] = null;
          transfers.push([twin, id, P[twin].role]);
          continue;
        }
        if (twin) {
          let n = 2, base = p.name.slice(0, 10);
          const names = new Set(ids.map((o) => P[o].name.toLowerCase()));
          while (names.has(`${base} ${n}`.toLowerCase())) n++;
          ups[`players/${id}/name`] = `${base} ${n}`;
        }
        let role = "spectator";
        if (this.state?.phase === "lobby") {
          role = SEATS.find((s) => !taken.has(s)) || "spectator";
          if (role !== "spectator") taken.add(role);
        }
        ups[`players/${id}/role`] = role;
        ups[`players/${id}/claimed`] = true;
      }
    }
    if (!Object.keys(ups).length) return;
    this._reconciling = true;
    update(ref(db, `rooms/${this.code}`), ups)
      .then(() => { for (const t of transfers) this.ev.onSeatTransfer?.(...t); })
      .catch((e) => console.warn("reconcile", e))
      .finally(() => { this._reconciling = false; });
  }
}

/* ---------------------------------------------------------------- player */

export async function roomExists(code) {
  await boot();
  return (await get(ref(db, `rooms/${code}/hostUid`))).exists();
}

/**
 * PlayerRoom: a phone's handle on a room.
 * events: onState, onTheme, onMe, onPlayers, onPrivate, onGone, onKicked
 */
export class PlayerRoom {
  constructor(code, events) { this.code = code; this.ev = events; this.unsubs = []; }
  r(p) { return ref(db, `rooms/${this.code}/${p}`); }

  async join(name) {
    await boot();
    if (!(await roomExists(this.code))) throw new Error("Room not found");
    if ((await get(this.r(`kicked/${uid}`))).val()) throw new Error("You were removed from this room");
    const meRef = this.r(`players/${uid}`);
    const existing = (await get(meRef)).val();
    if (existing) await update(meRef, { name, online: true, lastSeen: serverTimestamp() });
    else await set(meRef, { name, role: "spectator", claimed: false, online: true, lastSeen: serverTimestamp(), joinedAt: serverTimestamp() });
    this.uid = uid;
    this.joined = true;

    // presence
    this.unsubs.push(onValue(ref(db, ".info/connected"), (s) => {
      if (s.val() !== true) return;
      onDisconnect(meRef).update({ online: false, lastSeen: serverTimestamp() });
      update(meRef, { online: true, lastSeen: serverTimestamp() }).catch(() => {});
    }));
    this.hb = setInterval(() => {
      if (document.visibilityState === "visible") update(meRef, { online: true, lastSeen: serverTimestamp() }).catch(() => {});
    }, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", this._vis = () => {
      if (document.visibilityState === "visible") update(meRef, { online: true, lastSeen: serverTimestamp() }).catch(() => {});
    });

    this.unsubs.push(onValue(this.r("state"), (s) => this.ev.onState?.(s.val())));
    this.unsubs.push(onValue(this.r("theme"), (s) => this.ev.onTheme?.(s.val())));
    this.unsubs.push(onValue(this.r("players"), (s) => this.ev.onPlayers?.(s.val() || {})));
    this.unsubs.push(onValue(this.r(`private/${uid}`), (s) => this.ev.onPrivate?.(s.val() || {})));
    let seenMe = false;
    this.unsubs.push(onValue(meRef, (s) => {
      const v = s.val();
      if (v) { seenMe = true; this.ev.onMe?.(v); }
      else if (seenMe) this.checkGone();
    }));
    this.unsubs.push(onValue(this.r("hostUid"), (s) => { if (!s.exists()) this.leave("gone"); }));
    this.unsubs.push(onValue(this.r(`kicked/${uid}`), (s) => { if (s.val()) this.leave("kicked"); }));
    return this;
  }
  async checkGone() {
    const k = (await get(this.r(`kicked/${uid}`)).catch(() => null))?.val();
    this.leave(k ? "kicked" : "gone");
  }
  send(type, payload) {
    return set(this.r(`actions/${uid}`), { type, payload: payload ?? null, ts: serverTimestamp() });
  }
  leave(reason) {
    if (!this.joined) return;
    this.joined = false;
    this.unsubs.forEach((u) => u());
    clearInterval(this.hb);
    document.removeEventListener("visibilitychange", this._vis);
    if (reason === "kicked") this.ev.onKicked?.();
    else this.ev.onGone?.(reason);
  }
}

/* --------------------------------------------------------------- helpers */

let wakeLock = null;
export async function keepAwake() {
  if (!("wakeLock" in navigator)) return false;
  const req = async () => {
    try { if (!wakeLock || wakeLock.released) wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  };
  await req();
  if (!keepAwake._bound) {
    keepAwake._bound = true;
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") req(); });
  }
  return true;
}

// No double-tap / pinch zoom on phones (iOS ignores user-scalable=no).
export function noZoom() {
  let last = 0;
  document.addEventListener("touchend", (e) => {
    const t = Date.now();
    if (t - last < 350 && !e.target.closest("input,textarea")) e.preventDefault();
    last = t;
  }, { passive: false });
  for (const ev of ["gesturestart", "gesturechange", "dblclick"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

// D-pad spatial navigation for TV. Arrow keys move focus to the nearest
// focusable element in that direction; Enter/OK clicks it.
export function spatialNav(root = document) {
  const SEL = "button:not([disabled]),[data-nav]:not([disabled]),input,select,a[href]";
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const focusables = () => [...root.querySelectorAll(SEL)].filter(visible);
  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  document.addEventListener("keydown", (e) => {
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (!dir) {
      if ((e.key === "Enter" || e.keyCode === 23) && document.activeElement && document.activeElement !== document.body && document.activeElement.tagName !== "BUTTON" && document.activeElement.tagName !== "INPUT") {
        document.activeElement.click(); e.preventDefault();
      }
      return;
    }
    const list = focusables();
    if (!list.length) return;
    e.preventDefault();
    const cur = document.activeElement;
    if (!cur || !list.includes(cur)) { (list.find((el) => el.hasAttribute("data-autofocus")) || list[0]).focus(); return; }
    const c = center(cur.getBoundingClientRect());
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const p = center(el.getBoundingClientRect());
      const dx = p.x - c.x, dy = p.y - c.y;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 4) continue;
      const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) best.focus();
  });
}
export function focusFirst(root = document) {
  const el = root.querySelector("[data-autofocus]:not([disabled])") || root.querySelector("button:not([disabled])");
  if (el && (!document.activeElement || document.activeElement === document.body || !document.contains(document.activeElement) || document.activeElement.offsetParent === null)) el.focus();
}

// QR as inline SVG. Needs the qrcode-generator global (loaded via <script>).
export function qrSvg(text, { dark = "#000", light = "#fff" } = {}) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), q = 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q},${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
