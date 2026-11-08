// battleshits.js — the Battleshits game module.
//   1. Pure rules engine (no DOM, no Firebase) — testable in node.
//   2. createHost(): TV-side module implementing the platform interface
//      init(room) / onAction(uid, action) / render(state) (+ start, tick, onPlayersChanged, onSeatTransfer).
//   3. createPhone(): phone-side views (placement, battle, spectator, game over).
import { THEMES, getTheme, fmt } from "./themes.js";

export const id = "battleshits";
export const SIZE = 10;
export const FLEET = [5, 4, 3, 3, 2];
export const TURN_MS = 30000;
export const PAUSE_MAX_MS = 60000;
export const other = (s) => (s === "p1" ? "p2" : "p1");

/* ================================================================ engine */

export const arr = (v) =>
  Array.isArray(v) ? v.filter((x) => x != null)
  : v && typeof v === "object" ? Object.keys(v).sort((a, b) => a - b).map((k) => v[k])
  : [];

export function shipCells({ len, r, c, dir }) {
  const out = [];
  for (let i = 0; i < len; i++) out.push(dir === "h" ? [r, c + i] : [r + i, c]);
  return out;
}

export function cleanFleet(f) {
  return arr(f).map((s) => ({ len: Number(s?.len), r: Number(s?.r), c: Number(s?.c), dir: s?.dir === "v" ? "v" : s?.dir === "h" ? "h" : s?.dir }));
}

/** Returns null when valid, or a human-readable error. */
export function validateFleet(fleet) {
  if (!Array.isArray(fleet) || fleet.length !== FLEET.length) return "Fleet must have 5 ships";
  const occ = new Set();
  for (let i = 0; i < FLEET.length; i++) {
    const s = fleet[i];
    if (!s || s.len !== FLEET[i]) return "Wrong ship sizes";
    if (s.dir !== "h" && s.dir !== "v") return "Bad ship direction";
    if (!Number.isInteger(s.r) || !Number.isInteger(s.c)) return "Bad ship position";
    for (const [r, c] of shipCells(s)) {
      if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return "Ship out of bounds";
      const k = r * SIZE + c;
      if (occ.has(k)) return "Ships overlap";
      occ.add(k);
    }
  }
  return null;
}

export function randomFleet(rng = Math.random) {
  for (;;) {
    const occ = new Set();
    const fleet = [];
    let ok = true;
    for (const len of FLEET) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const dir = rng() < 0.5 ? "h" : "v";
        const r = Math.floor(rng() * (dir === "v" ? SIZE - len + 1 : SIZE));
        const c = Math.floor(rng() * (dir === "h" ? SIZE - len + 1 : SIZE));
        const s = { len, r, c, dir };
        const cells = shipCells(s);
        if (cells.some(([a, b]) => occ.has(a * SIZE + b))) continue;
        cells.forEach(([a, b]) => occ.add(a * SIZE + b));
        fleet.push(s);
        placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return fleet;
  }
}

export function initialState() {
  return {
    phase: "lobby", round: 0, turn: "p1", shotLog: [], sunk: { p1: [], p2: [] },
    ready: { p1: false, p2: false }, rematch: { p1: false, p2: false }, tally: { p1: 0, p2: 0 },
    winner: null, reveal: null, timerEndsAt: null, timerPausedLeft: null, pausedAt: null, pauseUsed: false,
    seats: { p1: null, p2: null },
  };
}

// Firebase drops empty arrays/objects/nulls and may hand arrays back as objects.
export function normalizeState(s) {
  const b = initialState();
  if (!s) return b;
  const n = { ...b, ...s };
  n.shotLog = arr(s.shotLog).map((x) => ({ ...x, ship: x.ship ?? null, auto: !!x.auto }));
  n.sunk = { p1: arr(s.sunk?.p1), p2: arr(s.sunk?.p2) };
  n.ready = { p1: !!s.ready?.p1, p2: !!s.ready?.p2 };
  n.rematch = { p1: !!s.rematch?.p1, p2: !!s.rematch?.p2 };
  n.tally = { p1: s.tally?.p1 || 0, p2: s.tally?.p2 || 0 };
  n.seats = { p1: s.seats?.p1 || null, p2: s.seats?.p2 || null };
  n.reveal = s.reveal ? { p1: cleanFleet(s.reveal.p1), p2: cleanFleet(s.reveal.p2) } : null;
  for (const k of ["winner", "timerEndsAt", "timerPausedLeft", "pausedAt"]) n[k] = s[k] ?? null;
  n.pauseUsed = !!s.pauseUsed;
  return n;
}
export function normalizeFleets(f) {
  return { p1: f?.p1 ? cleanFleet(f.p1) : null, p2: f?.p2 ? cleanFleet(f.p2) : null };
}

export function startPlacement(s) {
  const round = (s.round || 0) + 1;
  return {
    ...s, phase: "placement", round, turn: round % 2 === 1 ? "p1" : "p2",
    shotLog: [], sunk: { p1: [], p2: [] }, ready: { p1: false, p2: false }, rematch: { p1: false, p2: false },
    winner: null, reveal: null, timerEndsAt: null, timerPausedLeft: null, pausedAt: null, pauseUsed: false,
  };
}

export function placeFleet(s, fleets, seat, fleet, now) {
  if (s.phase !== "placement") return { error: "Not placing right now" };
  if (seat !== "p1" && seat !== "p2") return { error: "Spectators can't place ships" };
  if (s.ready[seat]) return { error: "Fleet already locked in" };
  const f = cleanFleet(fleet);
  const err = validateFleet(f);
  if (err) return { error: err };
  const nf = { ...fleets, [seat]: f };
  let ns = { ...s, ready: { ...s.ready, [seat]: true } };
  if (ns.ready.p1 && ns.ready.p2) ns = { ...ns, phase: "battle", timerEndsAt: now + TURN_MS, timerPausedLeft: null, pausedAt: null, pauseUsed: false };
  return { state: ns, fleets: nf, started: ns.phase === "battle" };
}

export const shotBy = (s, seat, r, c) => s.shotLog.find((x) => x.by === seat && x.r === r && x.c === c);

export function fire(s, fleets, seat, r, c, now, auto = false) {
  if (s.phase !== "battle") return { error: "Not in battle" };
  if (s.turn !== seat) return { error: "Not your turn" };
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= SIZE || c >= SIZE) return { error: "Off the grid" };
  if (shotBy(s, seat, r, c)) return { error: "Already fired there" };
  const target = other(seat);
  const tf = fleets[target];
  if (!tf) return { error: "Missing fleet" };
  let ship = -1;
  tf.forEach((sh, i) => { if (shipCells(sh).some(([a, b]) => a === r && b === c)) ship = i; });
  let result = "miss";
  if (ship >= 0) {
    const allHit = shipCells(tf[ship]).every(([a, b]) => (a === r && b === c) || shotBy(s, seat, a, b));
    result = allHit ? "sunk" : "hit";
  }
  // Only reveal which ship it was once it's sunk.
  const entry = { by: seat, r, c, result, ship: result === "sunk" ? ship : null, auto: !!auto, ts: now };
  let ns = { ...s, shotLog: [...s.shotLog, entry], timerPausedLeft: null, pausedAt: null, pauseUsed: false };
  const event = { ...entry, gameOver: false };
  if (result === "sunk") {
    ns.sunk = { ...s.sunk, [target]: [...s.sunk[target], ship] };
    if (ns.sunk[target].length === FLEET.length) {
      ns = { ...ns, phase: "gameOver", winner: seat, tally: { ...s.tally, [seat]: (s.tally[seat] || 0) + 1 }, reveal: { p1: fleets.p1, p2: fleets.p2 }, timerEndsAt: null };
      return { state: ns, event: { ...event, gameOver: true, winner: seat } };
    }
  }
  if (result === "miss") ns.turn = target; // a hit or sink grants another shot
  ns.timerEndsAt = now + TURN_MS;
  return { state: ns, event };
}

export function unshotCells(s, seat) {
  const out = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!shotBy(s, seat, r, c)) out.push([r, c]);
  return out;
}

export function timeoutShot(s, fleets, now, rng = Math.random) {
  const cells = unshotCells(s, s.turn);
  if (!cells.length) return { error: "No cells left" };
  const [r, c] = cells[Math.floor(rng() * cells.length)];
  return fire(s, fleets, s.turn, r, c, now, true);
}

export function requestRematch(s, seat) {
  if (s.phase !== "gameOver") return { error: "Game isn't over" };
  if (seat !== "p1" && seat !== "p2") return { error: "Spectators can't rematch" };
  const ns = { ...s, rematch: { ...s.rematch, [seat]: true } };
  if (ns.rematch.p1 && ns.rematch.p2) return { state: startPlacement(ns), restarted: true };
  return { state: ns };
}

/* ======================================================= shared rendering */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const seatName = (s, seat) => s.seats?.[seat]?.name || (seat === "p1" ? "Player 1" : "Player 2");

/**
 * Board markup. shots: entries aimed at this board. ships: fleet to draw (optional).
 * sunkIdx: indices of ships drawn as sunk. fresh: key of a shot to animate.
 */
function boardHTML({ shots = [], ships = [], sunkIdx = [], T, cls = "", tap = false, aim = null, freshKey = null, round = 0, hideShips = false }) {
  const marks = new Map();
  shots.forEach((x, i) => marks.set(x.r * SIZE + x.c, { ...x, i }));
  let cells = "";
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const m = marks.get(r * SIZE + c);
    let k = "cell";
    let inner = "";
    if (m) {
      k += m.result === "miss" ? " miss" : " hit";
      if (m.result === "sunk") k += " sunk";
      if (freshKey && freshKey === `${round}:${m.ts}:${m.r}:${m.c}`) k += " fresh";
      inner = `<span class="mark">${m.result === "miss" ? T.cellArt.miss : T.cellArt.hit}</span>`;
    } else if (tap) k += " open";
    if (aim && aim[0] === r && aim[1] === c) k += " aim";
    cells += tap ? `<button class="${k}" data-r="${r}" data-c="${c}" aria-label="${"ABCDEFGHIJ"[r]}${c + 1}">${inner}</button>` : `<div class="${k}">${inner}</div>`;
  }
  let bars = "";
  if (!hideShips) ships.forEach((s, i) => {
    if (!s) return;
    const sunk = sunkIdx.includes(i);
    bars += `<div class="shipbar dir-${s.dir}${sunk ? " sunk" : ""}" style="left:${s.c * 10}%;top:${s.r * 10}%;width:${(s.dir === "h" ? s.len : 1) * 10}%;height:${(s.dir === "v" ? s.len : 1) * 10}%"></div>`;
  });
  return `<div class="board-wrap ${cls}"><div class="grid${tap ? " tap" : ""}">${bars}${cells}</div></div>`;
}

function trackerHTML(T, sunkIdx) {
  return `<ul class="tracker">${T.ships.map((n, i) => `<li class="${sunkIdx.includes(i) ? "gone" : ""}"><span class="pips">${"■".repeat(FLEET[i])}</span> ${esc(n)}</li>`).join("")}</ul>`;
}

function lastShotKey(s) {
  const x = s.shotLog[s.shotLog.length - 1];
  return x ? `${s.round}:${x.ts}:${x.r}:${x.c}` : null;
}

/* ================================================================== host */

export function createHost() {
  let room = null;
  let root = null, screen = null, flashEl = null, emoteEl = null;
  const lastEmoteAt = {};
  const animated = new Set();
  let lastTickSec = null;

  const S = () => normalizeState(room.state);
  const F = () => normalizeFleets(room.secret?.fleets);

  function commitShot(res) {
    if (!res || res.error) return false;
    room.setState(res.state);
    const ev = res.event, T = room.theme;
    if (ev.result === "miss") { room.sound("miss"); flash(T.strings.miss + (ev.auto ? ` · ${T.strings.auto}` : ""), "miss"); }
    else if (ev.result === "hit") { room.sound("hit"); flash(T.strings.hit + (ev.auto ? ` · ${T.strings.auto}` : ""), "hit"); shake(); }
    else {
      room.sound("hit");
      setTimeout(() => room.sound("sunk"), 350);
      flash(fmt(T.strings.sunk, { ship: T.ships[ev.ship].toUpperCase() }), "sunk");
      shake();
    }
    if (ev.gameOver) setTimeout(() => room.sound("win"), 1600);
    return true;
  }

  function flash(text, kind) {
    if (!flashEl) return;
    flashEl.className = `bs-flash show ${kind}`;
    flashEl.textContent = text;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { flashEl.className = "bs-flash"; }, 1400);
  }
  function shake() {
    if (!screen) return;
    screen.classList.remove("shake");
    void screen.offsetWidth;
    screen.classList.add("shake");
  }
  function floatEmote(e, name) {
    if (!emoteEl) return;
    const d = document.createElement("div");
    d.className = "float-emote";
    d.style.left = `${8 + Math.random() * 84}%`;
    d.innerHTML = `<span class="e">${esc(e)}</span><span class="n">${esc(name)}</span>`;
    emoteEl.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }

  const mod = {
    id, themes: THEMES, initialState, normalizeState,
    init(r) {
      room = r;
      root = r.el;
      root.innerHTML = '<div class="bs-screen"></div><div class="bs-flash"></div><div class="emote-layer"></div>';
      screen = root.querySelector(".bs-screen");
      flashEl = root.querySelector(".bs-flash");
      emoteEl = root.querySelector(".emote-layer");
    },
    minPlayers: 2,
    canStart() { const s = room.seatInfo(); return !!(s.p1 && s.p2); },
    canChangeTheme(state) { return state.phase === "lobby" || state.phase === "gameOver"; },
    start() {
      if (!mod.canStart()) return;
      room.setState(startPlacement({ ...S(), seats: room.seatInfo() }));
      room.sound("ready");
    },
    onPlayersChanged() {
      if (!room.state) return;
      const s = S();
      const seats = room.seatInfo();
      if (JSON.stringify(seats) !== JSON.stringify(s.seats)) room.setState({ ...s, seats });
    },
    onSeatTransfer(oldUid, newUid, seat) {
      const f = F()[seat];
      if (f) room.setPrivate(newUid, "fleet", f);
    },
    onAction(uid, a) {
      const s = S();
      const seat = room.seatOf(uid);
      const T = room.theme;
      const t = room.now();
      switch (a.type) {
        case "placeFleet": {
          if (!seat) return;
          const res = placeFleet(s, F(), seat, a.payload?.fleet, t);
          if (res.error) { room.setPrivate(uid, "notice", { text: res.error, ts: t }); return; }
          room.setSecret({ ...(room.secret || {}), fleets: res.fleets });
          room.setPrivate(uid, "fleet", res.fleets[seat]);
          room.setPrivate(uid, "notice", null);
          room.setState(res.state);
          room.sound(res.started ? "turn" : "ready");
          return;
        }
        case "fire": {
          if (!seat) return;
          const res = fire(s, F(), seat, Number(a.payload?.r), Number(a.payload?.c), t);
          if (res.error) { room.setPrivate(uid, "notice", { text: res.error, ts: t }); return; }
          commitShot(res);
          return;
        }
        case "emote": {
          const e = a.payload?.e;
          if (!T.emotes.includes(e)) return;
          if (t - (lastEmoteAt[uid] || 0) < 1500) return;
          lastEmoteAt[uid] = t;
          floatEmote(e, room.players[uid]?.name || "");
          room.sound("emote", { volume: 0.6 });
          return;
        }
        case "rematch": {
          if (!seat) return;
          const res = requestRematch(s, seat);
          if (res.error) return;
          room.setState(res.state);
          room.sound(res.restarted ? "turn" : "ready");
          return;
        }
      }
    },
    tick(t) {
      if (!room?.state) return;
      const s = S();
      if (s.phase !== "battle") { lastTickSec = null; return; }
      const shooter = room.uidForSeat(s.turn);
      const online = !!shooter && room.isOnline(shooter);
      if (!online && s.timerPausedLeft == null && !s.pauseUsed && s.timerEndsAt) {
        room.setState({ ...s, timerPausedLeft: Math.max(1000, s.timerEndsAt - t), pausedAt: t, timerEndsAt: null });
        return;
      }
      if (s.timerPausedLeft != null) {
        if (online || t - (s.pausedAt || t) > PAUSE_MAX_MS) {
          room.setState({ ...s, timerEndsAt: t + Math.max(s.timerPausedLeft, online ? 10000 : 0), timerPausedLeft: null, pausedAt: null, pauseUsed: !online });
        }
        mod.updateTimer(s, t);
        return;
      }
      if (s.timerEndsAt && t >= s.timerEndsAt) {
        commitShot(timeoutShot(s, F(), t));
        return;
      }
      const left = Math.ceil((s.timerEndsAt - t) / 1000);
      if (left <= 5 && left > 0 && left !== lastTickSec) { lastTickSec = left; room.sound("tick"); }
      mod.updateTimer(s, t);
    },
    updateTimer(s, t) {
      const ring = root?.querySelector(".bs-ring");
      if (!ring) return;
      const paused = s.timerPausedLeft != null;
      const left = paused ? s.timerPausedLeft : Math.max(0, (s.timerEndsAt || t) - t);
      const frac = Math.max(0, Math.min(1, left / TURN_MS));
      ring.querySelector(".num").textContent = paused ? "⏸" : Math.ceil(left / 1000);
      ring.querySelector(".arc").style.strokeDashoffset = String(283 * (1 - frac));
      ring.classList.toggle("low", !paused && left <= 5000);
    },
    render(state) {
      if (!screen) return;
      const s = normalizeState(state);
      const T = room.theme;
      const n1 = esc(seatName(s, "p1")), n2 = esc(seatName(s, "p2"));
      const tally = `<div class="tally"><span>${n1}</span><b>${s.tally.p1}</b><i>—</i><b>${s.tally.p2}</b><span>${n2}</span></div>`;
      screen.dataset.phase = s.phase;
      if (s.phase === "placement") {
        const card = (seat) => `<div class="ready-card panel ${s.ready[seat] ? "is-ready" : ""}">
          <div class="who">${esc(seatName(s, seat))}</div>
          <div class="st">${s.ready[seat] ? "✅ Ready" : '<span class="dots">Placing</span>'}</div></div>`;
        screen.innerHTML = `<div class="bs-place">
          <h1 class="bs-title">${esc(T.strings.title)}</h1>
          <h2 class="bs-sub">${esc(T.strings.placing)}</h2>
          <div class="ready-row">${card("p1")}<div class="vs">VS</div>${card("p2")}</div>
          <p class="hint">Round ${s.round} · ${esc(T.name)} · ${s.turn === "p1" ? n1 : n2} shoots first</p>
          ${tally}</div>`;
        return;
      }
      if (s.phase === "battle") {
        const key = lastShotKey(s);
        const freshKey = key && !animated.has(key) && room.now() - (s.shotLog.at(-1)?.ts || 0) < 2500 ? key : null;
        if (freshKey) animated.add(freshKey);
        const fleets = F();
        const side = (seat) => {
          const shooter = other(seat);
          const shots = s.shotLog.filter((x) => x.by === shooter);
          const sunkIdx = s.sunk[seat];
          const ships = fleets[seat] ? sunkIdx.map((i) => fleets[seat][i]) : [];
          const target = s.turn === shooter;
          return `<section class="bs-side ${target ? "targeted" : ""}" data-seat="${seat}">
            <h2>${esc(fmt(T.strings.waters, { name: seatName(s, seat) }))}</h2>
            ${boardHTML({ shots, ships: fleets[seat] ? fleets[seat].map((sh, i) => (sunkIdx.includes(i) ? sh : null)) : [], sunkIdx, T, freshKey, round: s.round })}
            ${trackerHTML(T, sunkIdx)}</section>`;
        };
        const paused = s.timerPausedLeft != null;
        const banner = paused ? fmt(T.strings.waitingReconnect, { name: seatName(s, s.turn) }) : fmt(T.strings.tvTurn, { name: seatName(s, s.turn) });
        screen.innerHTML = `<div class="bs-battle">
          <header class="bs-top">
            <div class="bs-title sm">${esc(T.strings.title)}</div>
            <div class="bs-banner ${s.turn}">${esc(banner)}</div>
            <div class="bs-ring"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="45"/><circle class="arc" cx="50" cy="50" r="45"/></svg><span class="num"></span></div>
          </header>
          <div class="bs-boards">${side("p1")}${side("p2")}</div>
          ${tally}</div>`;
        mod.updateTimer(s, room.now());
        return;
      }
      if (s.phase === "gameOver") {
        const w = s.winner;
        const side = (seat) => {
          const shots = s.shotLog.filter((x) => x.by === other(seat));
          return `<section class="bs-side ${w === seat ? "winner" : "loser"}">
            <h2>${esc(seatName(s, seat))} ${w === seat ? "🏆" : T.cellArt.sunk}</h2>
            ${boardHTML({ shots, ships: s.reveal?.[seat] || [], sunkIdx: s.sunk[seat], T, cls: "small" })}</section>`;
        };
        const rm = (seat) => `<span class="rm ${s.rematch[seat] ? "yes" : ""}">${esc(seatName(s, seat))}: ${s.rematch[seat] ? "✅ wants a rematch" : "…"}</span>`;
        const themeBtns = Object.values(THEMES).map((th) => `<button class="btn theme-btn ${th.id === T.id ? "on" : ""}" data-theme="${th.id}" data-key="theme-${th.id}">${esc(th.name)}</button>`).join("");
        screen.innerHTML = `<div class="bs-over">
          <h1 class="bs-win">${esc(T.strings.victory)}</h1>
          <h2 class="bs-winner">${esc(fmt(T.strings.wins, { name: seatName(s, w) }))}</h2>
          <div class="bs-boards">${side("p1")}${side("p2")}</div>
          ${tally}
          <div class="rm-row">${rm("p1")}${rm("p2")}</div>
          <div class="over-ctl"><span class="lbl">Next round theme:</span>${themeBtns}<button class="btn ghost" data-act="end" data-key="end">End Room</button></div>
        </div>`;
        const prevKey = document.activeElement?.dataset?.key;
        screen.querySelectorAll("[data-theme]").forEach((b) => b.addEventListener("click", () => room.setTheme(b.dataset.theme)));
        screen.querySelector('[data-act="end"]').addEventListener("click", (e) => room.endRoom(e.currentTarget));
        const again = prevKey && screen.querySelector(`[data-key="${prevKey}"]`);
        (again || screen.querySelector(".theme-btn.on")).focus();
      }
    },
  };
  return mod;
}

/* ================================================================= phone */

export function createPhone() {
  let ctx = null;
  let v = null; // last view
  let local = { round: -1, ships: [], submitted: false };
  let prev = null; // for sound/vibration diffs
  let pending = null; // pending fire {r,c,at}
  let timerInt = null;
  let drag = null;
  let mode = null;

  const seatOf = () => (v?.me?.role === "p1" || v?.me?.role === "p2" ? v.me.role : null);

  function feedback(s) {
    const seat = seatOf();
    const T = v.theme;
    if (!prev || prev.round !== s.round) { prev = { round: s.round, len: s.shotLog.length, turn: s.turn, phase: s.phase }; return; }
    for (const x of s.shotLog.slice(prev.len)) {
      if (seat && x.by === seat) ctx.sound(x.result === "miss" ? "miss" : x.result === "hit" ? "hit" : "sunk");
      else if (seat && x.result !== "miss") { ctx.vibrate([90, 50, 140]); ctx.sound(x.result === "sunk" ? "sunk" : "hit", { volume: 0.5 }); }
    }
    if (seat && s.phase === "battle" && s.turn === seat && (prev.turn !== seat || prev.phase !== "battle")) { ctx.sound("turn"); ctx.vibrate(60); }
    if (s.phase === "gameOver" && prev.phase !== "gameOver" && seat) setTimeout(() => ctx.sound(s.winner === seat ? "win" : "lose"), 900);
    prev = { round: s.round, len: s.shotLog.length, turn: s.turn, phase: s.phase };
    void T;
  }

  function emoteBar(T) {
    return `<div class="emote-bar">${T.emotes.map((e) => `<button class="emote" data-e="${e}">${e}</button>`).join("")}</div>`;
  }
  function wireEmotes(el) {
    el.querySelectorAll(".emote").forEach((b) => b.addEventListener("click", () => {
      if (b.disabled) return;
      ctx.send("emote", { e: b.dataset.e });
      el.querySelectorAll(".emote").forEach((x) => { x.disabled = true; });
      setTimeout(() => el.querySelectorAll(".emote").forEach((x) => { x.disabled = false; }), 1500);
    }));
  }

  /* ----------------------------------------------------------- placement */

  function fits(ships, i, r, c, dir) {
    const s = { len: ships[i].len, r, c, dir };
    const occ = new Set();
    ships.forEach((o, j) => { if (j !== i && o.r != null) shipCells(o).forEach(([a, b]) => occ.add(a * SIZE + b)); });
    return shipCells(s).every(([a, b]) => a >= 0 && b >= 0 && a < SIZE && b < SIZE && !occ.has(a * SIZE + b));
  }

  function mountPlacement(el) {
    const T = v.theme;
    mode = "placement";
    el.innerHTML = `<div class="pl">
      <div class="ph-head"><h1>${esc(T.strings.placeTitle)}</h1><p class="sub">Drag ships onto the grid · tap a placed ship to rotate</p></div>
      <div class="pl-board">${boardHTML({ T })}</div>
      <div class="tray"></div>
      <p class="msg" aria-live="polite"></p>
      <div class="ph-actions"><button class="btn ghost" data-act="rand">🎲 Randomize</button><button class="btn" data-act="ready" disabled>Ready</button></div>
    </div>`;
    el.querySelector('[data-act="rand"]').addEventListener("click", () => {
      const f = randomFleet();
      local.ships = f.map((s, i) => ({ ...s, i }));
      ctx.sound("place");
      drawPlacement(el);
    });
    el.querySelector('[data-act="ready"]').addEventListener("click", () => {
      if (local.ships.some((s) => s.r == null)) return;
      const fleet = local.ships.map(({ len, r, c, dir }) => ({ len, r, c, dir }));
      if (validateFleet(fleet)) { msg(el, validateFleet(fleet)); return; }
      local.submitted = true;
      local.submittedAt = Date.now();
      ctx.send("placeFleet", { fleet });
      ctx.sound("ready");
      el.querySelector('[data-act="ready"]').disabled = true;
      msg(el, "Sending…");
    });
    drawPlacement(el);
  }

  function msg(el, text, bad) {
    const m = el.querySelector(".msg");
    if (!m) return;
    m.textContent = text || "";
    m.classList.toggle("bad", !!bad);
  }

  function drawPlacement(el) {
    const T = v.theme;
    const grid = el.querySelector(".pl-board .grid");
    grid.querySelectorAll(".shipbar").forEach((n) => n.remove());
    local.ships.forEach((s, i) => {
      if (s.r == null) return;
      const d = document.createElement("div");
      d.className = `shipbar dir-${s.dir} placeable`;
      d.style.cssText = `left:${s.c * 10}%;top:${s.r * 10}%;width:${(s.dir === "h" ? s.len : 1) * 10}%;height:${(s.dir === "v" ? s.len : 1) * 10}%`;
      d.innerHTML = `<span class="lbl">${esc(T.ships[i])}</span>`;
      d.addEventListener("pointerdown", (e) => startDrag(e, el, i, true));
      grid.appendChild(d);
    });
    const tray = el.querySelector(".tray");
    tray.innerHTML = "";
    const cs = grid.getBoundingClientRect().width / SIZE || 30;
    local.ships.forEach((s, i) => {
      if (s.r != null) return;
      const d = document.createElement("div");
      d.className = "tray-ship";
      d.innerHTML = `<div class="shipbar dir-h" style="position:relative;display:block;width:${s.len * cs * 0.78}px;height:${cs * 0.78}px"></div><span>${esc(T.ships[i])} (${s.len})</span>`;
      d.querySelector(".shipbar").addEventListener("pointerdown", (e) => startDrag(e, el, i, false));
      tray.appendChild(d);
    });
    if (!tray.children.length) tray.innerHTML = '<p class="tray-done">All ships placed — tap one to rotate, drag to move.</p>';
    const btn = el.querySelector('[data-act="ready"]');
    btn.disabled = local.submitted || local.ships.some((s) => s.r == null);
  }

  function startDrag(e, el, i, fromGrid) {
    if (local.submitted) return;
    e.preventDefault();
    const src = e.currentTarget;
    const ship = local.ships[i];
    const dir = fromGrid ? ship.dir : "h";
    const rect = src.getBoundingClientRect();
    const along = dir === "h" ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
    const grab = Math.max(0, Math.min(ship.len - 1, Math.floor(along * ship.len)));
    drag = { i, el, src, grab, dir, fromGrid, x0: e.clientX, y0: e.clientY, moved: false, lift: e.pointerType === "touch" ? 1.1 : 0, target: null, ghost: null };
    try { src.setPointerCapture(e.pointerId); } catch {}
    src.onpointermove = onDragMove;
    src.onpointerup = onDragEnd;
    src.onpointercancel = () => cancelDrag();
  }

  function onDragMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return;
    const grid = drag.el.querySelector(".pl-board .grid");
    const g = grid.getBoundingClientRect();
    const cs = g.width / SIZE;
    const ship = local.ships[drag.i];
    if (!drag.moved) {
      drag.moved = true;
      drag.src.style.opacity = "0.25";
      drag.ghost = document.createElement("div");
      drag.ghost.className = `shipbar ghost dir-${drag.dir}`;
      drag.ghost.style.cssText = `position:fixed;z-index:50;pointer-events:none;width:${(drag.dir === "h" ? ship.len : 1) * cs}px;height:${(drag.dir === "v" ? ship.len : 1) * cs}px`;
      document.body.appendChild(drag.ghost);
    }
    const lift = drag.lift * cs;
    const left = e.clientX - (drag.dir === "h" ? (drag.grab + 0.5) * cs : 0.5 * cs);
    const top = e.clientY - lift - (drag.dir === "v" ? (drag.grab + 0.5) * cs : 0.5 * cs);
    drag.ghost.style.left = `${left}px`;
    drag.ghost.style.top = `${top}px`;
    const c = Math.round((left - g.left) / cs);
    const r = Math.round((top - g.top) / cs);
    const py = e.clientY - lift;
    const over = e.clientX > g.left - cs && e.clientX < g.right + cs && py > g.top - cs && py < g.bottom + cs;
    const ok = over && fits(local.ships, drag.i, r, c, drag.dir);
    drag.target = { r, c, over, ok };
    drag.ghost.classList.toggle("ok", ok);
    drag.ghost.classList.toggle("bad", over && !ok);
  }

  function onDragEnd() {
    if (!drag) return;
    const d = drag;
    cancelDrag();
    const ship = local.ships[d.i];
    if (!d.moved) {
      if (d.fromGrid) rotate(d.el, d.i);
      return;
    }
    if (d.target?.ok) {
      Object.assign(ship, { r: d.target.r, c: d.target.c, dir: d.dir });
      ctx.sound("place");
      msg(d.el, "");
    } else if (d.fromGrid && !d.target?.over) {
      Object.assign(ship, { r: null, c: null, dir: "h" });
    } else if (d.target?.over) {
      ctx.sound("error");
      msg(d.el, "Can't go there — ships can't overlap or hang off the edge", true);
    }
    drawPlacement(d.el);
  }
  function cancelDrag() {
    if (!drag) return;
    drag.ghost?.remove();
    if (drag.src) { drag.src.style.opacity = ""; drag.src.onpointermove = drag.src.onpointerup = drag.src.onpointercancel = null; }
    drag = null;
  }

  function rotate(el, i) {
    const s = local.ships[i];
    const nd = s.dir === "h" ? "v" : "h";
    // try in place, then nudge back inside the grid
    const tries = [[s.r, s.c]];
    for (let k = 1; k < s.len; k++) tries.push(nd === "v" ? [s.r - k, s.c] : [s.r, s.c - k]);
    for (const [r, c] of tries) {
      if (fits(local.ships, i, r, c, nd)) {
        Object.assign(s, { r, c, dir: nd });
        ctx.sound("place");
        msg(el, "");
        drawPlacement(el);
        return;
      }
    }
    ctx.sound("error");
    msg(el, "No room to rotate there", true);
    const bar = el.querySelectorAll(".pl-board .shipbar")[local.ships.filter((x, j) => j < i && x.r != null).length];
    bar?.classList.add("wiggle");
    setTimeout(() => bar?.classList.remove("wiggle"), 400);
  }

  /* ------------------------------------------------------------- screens */

  function renderWaitingPlacement(el, s) {
    const T = v.theme, seat = seatOf();
    mode = "placed";
    const opp = other(seat);
    el.innerHTML = `<div class="pw">
      <h1>Fleet locked in ✅</h1>
      <p class="sub">${s.ready[opp] ? "Starting…" : `Waiting for ${esc(seatName(s, opp))}…`}</p>
      ${boardHTML({ ships: arr(v.priv?.fleet), T, cls: "mid" })}
      ${emoteBar(T)}</div>`;
    wireEmotes(el);
  }

  function renderBattle(el, s) {
    const T = v.theme, seat = seatOf();
    mode = "battle";
    const opp = other(seat);
    const mine = s.turn === seat;
    const myShots = s.shotLog.filter((x) => x.by === seat);
    const inShots = s.shotLog.filter((x) => x.by === opp);
    if (pending && (myShots.some((x) => x.r === pending.r && x.c === pending.c) || Date.now() - pending.at > 4000 || !mine)) pending = null;
    const status = mine ? T.strings.yourTurn : fmt(T.strings.theirTurn, { name: seatName(s, opp) });
    const myFleet = arr(v.priv?.fleet);
    el.innerHTML = `<div class="pb ${mine ? "mine" : "theirs"}">
      <div class="pb-status"><span class="t">${esc(status)}</span><span class="timer"></span></div>
      <div class="pb-enemy">${boardHTML({ shots: myShots, T, tap: mine && !pending, aim: pending ? [pending.r, pending.c] : null, cls: "big" })}
        <div class="pb-label">${esc(fmt(T.strings.waters, { name: seatName(s, opp) }))}</div></div>
      <div class="pb-bottom">
        <div class="pb-own">${boardHTML({ shots: inShots, ships: myFleet, sunkIdx: s.sunk[seat], T, cls: "mini" })}<div class="pb-label">Your fleet</div></div>
        <div class="pb-track">${trackerHTML(T, s.sunk[opp])}</div>
      </div>
      ${emoteBar(T)}</div>`;
    const grid = el.querySelector(".pb-enemy .grid");
    grid.addEventListener("click", (e) => {
      const b = e.target.closest(".cell");
      if (!b) return;
      if (!mine || pending) { ctx.sound("error"); return; }
      if (!b.classList.contains("open")) { ctx.sound("error"); return; }
      pending = { r: +b.dataset.r, c: +b.dataset.c, at: Date.now() };
      b.classList.add("aim");
      grid.querySelectorAll(".cell.open").forEach((x) => x.classList.remove("open"));
      ctx.send("fire", { r: pending.r, c: pending.c });
    });
    wireEmotes(el);
    tickTimer(el, s);
  }

  function renderSpectator(el, s) {
    const T = v.theme;
    mode = "spectator";
    const n1 = esc(seatName(s, "p1")), n2 = esc(seatName(s, "p2"));
    let status = "";
    if (s.phase === "placement") status = T.strings.placing;
    else if (s.phase === "battle") status = fmt(T.strings.tvTurn, { name: seatName(s, s.turn) });
    else if (s.phase === "gameOver") status = fmt(T.strings.wins, { name: seatName(s, s.winner) });
    const b = (seat) => `<div class="sp-side"><div class="pb-label">${esc(fmt(T.strings.waters, { name: seatName(s, seat) }))}</div>
      ${boardHTML({ shots: s.shotLog.filter((x) => x.by === other(seat)), ships: s.phase === "gameOver" ? s.reveal?.[seat] || [] : [], sunkIdx: s.sunk[seat], T, cls: "mini" })}</div>`;
    el.innerHTML = `<div class="sp">
      <div class="badge">👀 Spectating</div>
      <div class="tally"><span>${n1}</span><b>${s.tally.p1}</b><i>—</i><b>${s.tally.p2}</b><span>${n2}</span></div>
      <div class="pb-status"><span class="t">${esc(status)}</span><span class="timer"></span></div>
      <div class="sp-boards">${b("p1")}${b("p2")}</div>
      <p class="sub">Send emotes to the TV:</p>
      ${emoteBar(T)}</div>`;
    wireEmotes(el);
    tickTimer(el, s);
  }

  function renderOver(el, s) {
    const T = v.theme, seat = seatOf();
    mode = "over";
    const won = s.winner === seat;
    const opp = other(seat);
    const n1 = esc(seatName(s, "p1")), n2 = esc(seatName(s, "p2"));
    el.innerHTML = `<div class="po ${won ? "won" : "lost"}">
      <h1 class="big">${esc(won ? T.strings.victory : T.strings.defeatPhone)}</h1>
      <p class="sub">${esc(fmt(T.strings.wins, { name: seatName(s, s.winner) }))}</p>
      <div class="tally"><span>${n1}</span><b>${s.tally.p1}</b><i>—</i><b>${s.tally.p2}</b><span>${n2}</span></div>
      ${boardHTML({ shots: s.shotLog.filter((x) => x.by === seat), ships: s.reveal?.[opp] || [], sunkIdx: s.sunk[opp], T, cls: "mid" })}
      <div class="pb-label">${esc(seatName(s, opp))}'s fleet, revealed</div>
      <button class="btn huge" data-act="rematch" ${s.rematch[seat] ? "disabled" : ""}>${s.rematch[seat] ? "Waiting…" : `🔁 ${esc(T.strings.rematch)}`}</button>
      <p class="sub">${s.rematch[opp] ? `${esc(seatName(s, opp))} wants a rematch!` : s.rematch[seat] ? `Waiting for ${esc(seatName(s, opp))}…` : ""}</p>
      ${emoteBar(T)}</div>`;
    el.querySelector('[data-act="rematch"]').addEventListener("click", () => { ctx.send("rematch"); ctx.sound("ready"); });
    wireEmotes(el);
  }

  function tickTimer(el, s) {
    clearInterval(timerInt);
    const upd = () => {
      const t = el.querySelector(".timer");
      if (!t || !v || normalizeState(v.state).phase !== "battle") { clearInterval(timerInt); return; }
      const st = normalizeState(v.state);
      if (st.timerPausedLeft != null) { t.textContent = "⏸"; return; }
      const left = Math.max(0, Math.ceil(((st.timerEndsAt || 0) - ctx.now()) / 1000));
      t.textContent = `${left}s`;
      t.classList.toggle("low", left <= 5);
    };
    if (s.phase === "battle") { upd(); timerInt = setInterval(upd, 250); }
  }

  return {
    mount(c) { ctx = c; },
    render(view) {
      v = view;
      const el = ctx.el;
      const s = normalizeState(view.state);
      const seat = seatOf();
      feedback(s);
      if (!seat) { cancelDrag(); renderSpectator(el, s); return; }
      if (s.phase === "placement") {
        if (local.round !== s.round) { local = { round: s.round, ships: FLEET.map((len, i) => ({ len, i, r: null, c: null, dir: "h" })), submitted: false }; mode = null; }
        if (s.ready[seat]) { cancelDrag(); renderWaitingPlacement(el, s); return; }
        // the TV rejected our fleet?
        const n = view.priv?.notice;
        if (local.submitted && n && n.ts && n.ts > (local.noticeSeen || 0)) {
          local.noticeSeen = n.ts;
          local.submitted = false;
          if (mode === "placement") { drawPlacement(el); msg(el, n.text, true); }
        }
        if (local.submitted && Date.now() - (local.submittedAt || 0) > 8000) local.submitted = false; // allow retry
        if (mode !== "placement") mountPlacement(el);
        return;
      }
      cancelDrag();
      if (s.phase === "battle") { renderBattle(el, s); return; }
      if (s.phase === "gameOver") { renderOver(el, s); return; }
    },
  };
}
