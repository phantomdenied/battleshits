// scribble.js — a crossword word game for 2–4 players on an 11×11 board.
// Everyone has a rack of 7 letter tiles; on your turn, lay tiles in one line
// to make words that connect to the board. Words are checked against the
// WordSoHard dictionary API (https://wordsohard.com, free, keyless, CORS).
// If the API can't be reached the play is accepted unchecked.
// Racks and the bag live in `secret`; each player's rack is copied to
// private/{uid}/rack. The board is a 121-character string ("." = empty,
// lowercase = a blank tile standing in for that letter).
import { esc, seatList, tvLayers, handleEmote, ringHTML, updateRing, tickSound, overControlsHTML, wireOverControls, emoteBarHTML, wireEmotes, phoneTimer } from "./kit.js";

export const id = "scribble";
export const SEATS = seatList(4);
export const N = 11, CENTER = 60, RACK = 7, BINGO = 50;
export const TURN_MS = 120000, AWAY_MS = 30000; // skip a player only after 30s offline (phones lock while people think)
export const API = "https://wordsohard.com/api/v1";
export const CREDIT = "Words checked and defined by WordSoHard (wordsohard.com)";

export const VALUES = { A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, "?": 0 };
// 70 tiles: sized for the smaller board.
const DIST = { E: 8, A: 6, I: 5, O: 5, N: 4, R: 4, T: 4, S: 3, L: 3, U: 2, D: 3, G: 2, B: 2, C: 2, M: 2, P: 2, F: 1, H: 2, V: 1, W: 1, Y: 1, K: 1, J: 1, X: 1, Q: 1, Z: 1, "?": 2 };
export const FULL_BAG = Object.entries(DIST).map(([l, n]) => l.repeat(n)).join("");

// One quadrant of premium squares (rows/cols 0–5), mirrored to all four corners.
const QUAD = [
  ["W3", "", "", "L2", "", "L3"],
  ["", "W2", "", "", "", ""],
  ["", "", "L3", "", "L2", ""],
  ["L2", "", "", "W2", "", ""],
  ["", "", "L2", "", "", "L2"],
  ["L3", "", "", "", "L2", "*"],
];
export const prem = (i) => { const r = Math.floor(i / N), c = i % N; return QUAD[Math.min(r, N - 1 - r)][Math.min(c, N - 1 - c)]; };
const PREM_LABEL = { W3: "3×W", W2: "2×W", L3: "3×L", L2: "2×L", "*": "★" };
export const EMPTY_BOARD = ".".repeat(N * N);

const SKIN = {
  classic: { title: "Scribble", bingo: "SCRIBBLE! +50", bounce: "NOT A WORD!" },
  shit: { title: "Skidmarks", bingo: "SKIDMARK! +50", bounce: "THAT STINKS!" },
};
const skin = (T) => SKIN[T.id] || SKIN.classic;

/* ---------------------------------------------------------------- engine */

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const rackValue = (rack) => [...(rack || "")].reduce((n, l) => n + (VALUES[l] || 0), 0);
const tileValue = (ch) => (ch >= "A" && ch <= "Z" ? VALUES[ch] : 0); // lowercase = blank = 0

/** The run of tiles through cell i along (dr,dc), as a list of cell indexes. */
function lineWord(b, i, horizontal) {
  const r0 = Math.floor(i / N), c0 = i % N;
  const dr = horizontal ? 0 : 1, dc = horizontal ? 1 : 0;
  let r = r0, c = c0;
  while (r - dr >= 0 && c - dc >= 0 && b[(r - dr) * N + (c - dc)] !== ".") { r -= dr; c -= dc; }
  const cells = [];
  while (r < N && c < N && b[r * N + c] !== ".") { cells.push(r * N + c); r += dr; c += dc; }
  return cells;
}

/**
 * Check a play and score it (without the dictionary). tiles: [{i, l, as}]
 * where l is the rack letter ("?" for a blank) and as is the blank's letter.
 * Returns { error } or { board, rack, words: [{w, s, cells}], total, bingo, placed }.
 */
export function evaluatePlay(board, rack, tiles) {
  if (!Array.isArray(tiles) || !tiles.length) return { error: "Put some tiles on the board first" };
  if (tiles.length > RACK) return { error: "Too many tiles" };
  const b = [...board], left = [...(rack || "")], placed = [];
  for (const t of tiles) {
    const i = Number(t?.i);
    if (!Number.isInteger(i) || i < 0 || i >= N * N) return { error: "That's off the board" };
    if (placed.includes(i)) return { error: "Two tiles on one square" };
    if (b[i] !== ".") return { error: "That square is taken" };
    const l = String(t?.l || "").toUpperCase();
    const k = left.indexOf(l);
    if (k < 0) return { error: "That tile isn't in your rack" };
    left.splice(k, 1);
    let ch;
    if (l === "?") {
      const as = String(t?.as || "").toUpperCase();
      if (!/^[A-Z]$/.test(as)) return { error: "Pick a letter for the blank tile" };
      ch = as.toLowerCase();
    } else if (/^[A-Z]$/.test(l)) ch = l;
    else return { error: "That tile isn't in your rack" };
    b[i] = ch;
    placed.push(i);
  }
  placed.sort((x, y) => x - y);
  const rows = new Set(placed.map((i) => Math.floor(i / N))), cols = new Set(placed.map((i) => i % N));
  if (rows.size > 1 && cols.size > 1) return { error: "Tiles must go in one straight line" };
  const horizontal = placed.length === 1 || rows.size === 1;
  const step = horizontal ? 1 : N;
  for (let i = placed[0]; i <= placed[placed.length - 1]; i += step) if (b[i] === ".") return { error: "No gaps between your tiles" };
  const first = !board.replace(/\./g, "").length;
  if (first) {
    if (!placed.includes(CENTER)) return { error: "The first word must cover the ★ in the middle" };
    if (placed.length < 2) return { error: "The first word needs at least 2 letters" };
  }
  const lines = [];
  const main = lineWord(b, placed[0], horizontal);
  if (main.length >= 2) lines.push(main);
  for (const i of placed) { const w = lineWord(b, i, !horizontal); if (w.length >= 2) lines.push(w); }
  if (!lines.length) return { error: "Make a word of at least 2 letters" };
  if (!first && !lines.some((w) => w.some((c) => !placed.includes(c)))) return { error: "Your word has to connect to the tiles on the board" };
  let total = 0;
  const words = lines.map((cells) => {
    let sum = 0, mult = 1;
    for (const c of cells) {
      let v = tileValue(b[c]);
      if (placed.includes(c)) {
        const p = prem(c);
        if (p === "L2") v *= 2; else if (p === "L3") v *= 3; else if (p === "W2" || p === "*") mult *= 2; else if (p === "W3") mult *= 3;
      }
      sum += v;
    }
    total += sum * mult;
    return { w: cells.map((c) => b[c].toUpperCase()).join(""), s: sum * mult, cells };
  });
  const bingo = placed.length === RACK;
  if (bingo) total += BINGO;
  return { board: b.join(""), rack: left.join(""), words, total, bingo, placed };
}

export function initialState() {
  return { game: id, phase: "lobby", order: [], names: {}, scores: {}, turn: null, board: EMPTY_BOARD, bag: 0, tiles: {}, last: null, lastPlay: null, scoreless: 0, checking: null, bounce: null, final: null, leftover: null, timerEndsAt: null, turnAt: null, game_no: 0 };
}
export function normalizeState(s) {
  const b = initialState();
  if (!s) return b;
  const n = { ...b, ...s, game: id };
  n.order = Array.isArray(s.order) ? s.order.filter(Boolean) : s.order && typeof s.order === "object" ? Object.values(s.order) : [];
  for (const k of ["names", "scores", "tiles"]) n[k] = { ...(s[k] || {}) };
  for (const k of ["turn", "last", "lastPlay", "checking", "bounce", "final", "leftover", "timerEndsAt", "turnAt", "outBy"]) n[k] = s[k] ?? null;
  if (typeof n.board !== "string" || n.board.length !== N * N) n.board = EMPTY_BOARD;
  if (n.bounce) n.bounce = { ...n.bounce, words: Object.values(n.bounce.words || {}) };
  const fix = (l) => (l ? { ...l, words: Object.values(l.words || {}), cells: Object.values(l.cells || {}) } : null);
  n.last = fix(n.last);
  n.lastPlay = fix(n.lastPlay);
  return n;
}
const tileCounts = (racks) => Object.fromEntries(Object.entries(racks).map(([k, r]) => [k, r.length]));

/** New game: shuffle the bag, deal 7 to each seated player. */
export function startGame(s, seated, now, rng = Math.random) {
  const seats = SEATS.filter((x) => seated[x]);
  const no = (s.game_no || 0) + 1;
  const k = (no - 1) % Math.max(1, seats.length);
  const order = [...seats.slice(k), ...seats.slice(0, k)];
  let bag = shuffle([...FULL_BAG], rng).join("");
  const racks = {};
  for (const x of order) { racks[x] = bag.slice(0, RACK); bag = bag.slice(RACK); }
  const state = {
    ...initialState(), phase: "playing", order, game_no: no,
    names: Object.fromEntries(order.map((x) => [x, seated[x].name])),
    scores: Object.fromEntries(order.map((x) => [x, 0])),
    turn: order[0], bag: bag.length, tiles: tileCounts(racks), timerEndsAt: now + TURN_MS, turnAt: now,
  };
  return { state, secret: { bag, racks } };
}

function nextTurn(s, sec, now) {
  if (s.scoreless >= s.order.length * 2) return finish(s, sec, now, null);
  const i = s.order.indexOf(s.turn);
  return { state: { ...s, turn: s.order[(i + 1) % s.order.length], checking: null, timerEndsAt: now + TURN_MS, turnAt: now }, secret: sec };
}

/** End the game. outSeat = who used their last tile (gets everyone's leftovers). */
export function finish(s, sec, now, outSeat) {
  const final = {}, leftover = {};
  let pot = 0;
  for (const x of s.order) {
    const r = sec.racks[x] || "";
    leftover[x] = r;
    if (x === outSeat) continue;
    const v = rackValue(r);
    final[x] = -v;
    pot += v;
  }
  if (outSeat) final[outSeat] = pot;
  const scores = { ...s.scores };
  for (const [x, v] of Object.entries(final)) scores[x] = (scores[x] || 0) + v;
  return { state: { ...s, phase: "gameOver", scores, final, leftover, turn: null, checking: null, timerEndsAt: null, outBy: outSeat || null }, secret: sec };
}

/** Apply an already-evaluated (and dictionary-checked) play. */
export function commitPlay(s, sec, seat, ev, now, extra = {}) {
  const draw = sec.bag.slice(0, RACK - ev.rack.length);
  const racks = { ...sec.racks, [seat]: ev.rack + draw };
  const bag = sec.bag.slice(draw.length);
  const nsec = { bag, racks };
  const last = { by: seat, type: "play", words: ev.words.map(({ w, s: pts }) => ({ w, s: pts })), total: ev.total, bingo: ev.bingo, cells: ev.placed, ts: now, ...extra };
  const st = { ...s, lastPlay: last, board: ev.board, scores: { ...s.scores, [seat]: (s.scores[seat] || 0) + ev.total }, bag: bag.length, tiles: tileCounts(racks), last, scoreless: 0, bounce: null, checking: null };
  if (!racks[seat].length && !bag.length) return finish(st, nsec, now, seat);
  return nextTurn(st, nsec, now);
}

/** Swap some tiles (letters as a string, "?" for blanks) with the bag. */
export function swapTiles(s, sec, seat, letters, now, rng = Math.random) {
  if (s.phase !== "playing") return { error: "The game isn't on" };
  if (s.turn !== seat) return { error: "Not your turn" };
  const want = [...String(letters || "").toUpperCase()];
  if (!want.length) return { error: "Pick tiles to swap" };
  if (want.length > sec.bag.length) return { error: `Only ${sec.bag.length} tiles left in the bag` };
  const left = [...sec.racks[seat]];
  for (const l of want) { const k = left.indexOf(l); if (k < 0) return { error: "That tile isn't in your rack" }; left.splice(k, 1); }
  const draw = sec.bag.slice(0, want.length);
  const bag = shuffle([...sec.bag.slice(want.length), ...want], rng).join("");
  const racks = { ...sec.racks, [seat]: left.join("") + draw };
  return nextTurn({ ...s, last: { by: seat, type: "swap", n: want.length, ts: now }, scoreless: s.scoreless + 1, bounce: null }, { bag, racks }, now);
}

/** Pass (or time out / away). */
export function passTurn(s, sec, seat, now, type = "pass") {
  if (s.phase !== "playing") return { error: "The game isn't on" };
  if (s.turn !== seat) return { error: "Not your turn" };
  return nextTurn({ ...s, last: { by: seat, type, ts: now }, scoreless: s.scoreless + 1, bounce: null }, sec, now);
}

export const leaders = (s) => [...s.order].sort((a, b) => (s.scores[b] || 0) - (s.scores[a] || 0));

/* ------------------------------------------------------------ dictionary */

const wordCache = new Map();
/** Check words with WordSoHard. Returns { invalid: [...] } or { offline: true }. Never throws. */
export async function checkWords(words, fetchFn = globalThis.fetch, timeoutMs = 7000) {
  const uniq = [...new Set(words.map((w) => w.toLowerCase()))];
  const todo = uniq.filter((w) => !wordCache.has(w));
  if (todo.length) {
    try {
      const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = setTimeout(() => ac?.abort(), timeoutMs);
      const res = await fetchFn(`${API}/check/${todo.map(encodeURIComponent).join(",")}`, ac ? { signal: ac.signal } : undefined);
      clearTimeout(timer);
      if (!res.ok && res.status) return { offline: true };
      const data = await res.json();
      for (const r of data.results || []) wordCache.set(String(r.word).toLowerCase(), !!r.valid);
      if (todo.some((w) => !wordCache.has(w))) return { offline: true };
    } catch { return { offline: true }; }
  }
  return { invalid: uniq.filter((w) => !wordCache.get(w)).map((w) => w.toUpperCase()) };
}
/** First definition of a word, or null. Never throws. */
export async function defineWord(word, fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn(`${API}/define/${encodeURIComponent(word.toLowerCase())}`);
    const d = await res.json();
    const def = d?.found && d.definitions?.[0];
    if (!def?.definition) return null;
    const text = String(def.definition);
    return { word: word.toUpperCase(), pos: String(def.partOfSpeech || d.partOfSpeech || ""), text: text.length > 180 ? text.slice(0, 177) + "…" : text };
  } catch { return null; }
}

/* -------------------------------------------------------------- render */

const nm = (s, seat) => s.names?.[seat] || `Player ${String(seat || "").slice(1)}`;

/** Board HTML. extra: { staged: {i: ch}, hot: [cells], tap: bool } */
function boardHTML(board, { staged = {}, hot = [], tap = false, cls = "" } = {}) {
  let h = "";
  for (let i = 0; i < N * N; i++) {
    const ch = staged[i] || (board[i] !== "." ? board[i] : "");
    const p = prem(i);
    if (ch) {
      const blank = ch !== ch.toUpperCase();
      const c = staged[i] ? "staged" : hot.includes(i) ? "hot" : "";
      h += `<div class="sc-cell tile ${c} ${blank ? "blank" : ""}" data-i="${i}"><span class="l">${esc(ch.toUpperCase())}</span>${blank ? "" : `<span class="v">${VALUES[ch]}</span>`}</div>`;
    } else h += `<div class="sc-cell ${p ? "p-" + (p === "*" ? "star" : p) : ""}" data-i="${i}">${p ? `<span class="pl">${PREM_LABEL[p]}</span>` : ""}</div>`;
  }
  return `<div class="sc-board ${tap ? "tap" : ""} ${cls}">${h}</div>`;
}
const tileHTML = (l, attrs = "", cls = "") => `<button class="sc-rt ${cls}" ${attrs}><span class="l">${l === "?" ? "" : esc(l)}</span><span class="v">${l === "?" ? "" : VALUES[l]}</span></button>`;

function lastText(s) {
  const l = s.last;
  if (!l) return "";
  const who = nm(s, l.by);
  if (l.type === "play") return `${who}: ${l.words.map((w) => w.w).join(", ")} +${l.total}`;
  if (l.type === "swap") return `${who} swapped ${l.n} tile${l.n > 1 ? "s" : ""}`;
  if (l.type === "timeout") return `${who} ran out of time`;
  if (l.type === "away") return `${who} is away, skipped`;
  return `${who} passed`;
}
function scoresHTML(s, { final = false } = {}) {
  return `<ol class="sc-scores">${leaders(s).map((x) => `<li class="${x === s.turn ? "turn" : ""}">
    <span class="n">${esc(nm(s, x))}</span>
    ${final && s.final?.[x] != null ? `<span class="adj ${s.final[x] >= 0 ? "up" : "down"}">${s.final[x] >= 0 ? "+" : ""}${s.final[x]}</span>` : `<span class="tc">${"▪".repeat(s.tiles[x] || 0)}</span>`}
    <b>${s.scores[x] || 0}</b></li>`).join("")}</ol>`;
}

/* ------------------------------------------------------------------- TV */

export function createHost() {
  let room = null, L = null, busy = null, poppedTs = null;
  const awaySince = {};
  const lastEmoteAt = {}, tickMemo = {};
  const S = () => normalizeState(room.state);
  const SEC = () => ({ bag: room.secret?.bag || "", racks: { ...(room.secret?.racks || {}) } });
  const away = (seat) => { const u = room.uidForSeat(seat); return !u || !room.isOnline(u); };

  function pushRacks(sec, only) {
    for (const x of only || Object.keys(sec.racks)) {
      const u = room.uidForSeat(x);
      if (u) room.setPrivate(u, "rack", sec.racks[x] || "");
    }
  }
  function apply(res, seats) {
    room.setSecret(res.secret);
    pushRacks(res.secret, seats);
    room.setState(res.state);
    if (res.state.phase === "gameOver") room.sound("win");
    else room.sound("turn");
  }

  async function play(uid, seat, tiles) {
    const s = S(), t = room.now();
    const notice = (text) => room.setPrivate(uid, "notice", { text, ts: room.now() });
    if (s.phase !== "playing") return;
    if (s.turn !== seat) return notice("Not your turn");
    if (busy) return notice("Still checking your last word…");
    const sec = SEC();
    const ev = evaluatePlay(s.board, sec.racks[seat], tiles);
    if (ev.error) return notice(ev.error);
    busy = { seat, at: t };
    room.setState({ ...s, checking: seat });
    const chk = await checkWords(ev.words.map((w) => w.w));
    busy = null;
    const s2 = S();
    if (s2.phase !== "playing" || s2.turn !== seat || s2.board !== s.board) { if (s2.checking) room.setState({ ...s2, checking: null }); return; }
    if (chk.invalid?.length) {
      const bad = chk.invalid;
      notice(`${bad.join(", ")} ${bad.length > 1 ? "aren't words" : "isn't a word"} in the dictionary. Try again!`);
      room.setState({ ...s2, checking: null, bounce: { by: seat, words: bad, ts: room.now() } });
      room.sound("miss");
      L.flash(skin(room.theme).bounce, "sunk");
      L.shake();
      return;
    }
    const res = commitPlay(s2, SEC(), seat, ev, room.now(), chk.offline ? { unchecked: true } : {});
    room.setPrivate(uid, "notice", null);
    apply(res, [seat]);
    if (ev.bingo) { room.sound("win"); L.flash(skin(room.theme).bingo, "hit"); }
    else room.sound("hit");
    // look up the best word's meaning for the TV
    const best = [...ev.words].sort((a, b) => b.w.length - a.w.length || b.s - a.s)[0];
    const def = chk.offline ? null : await defineWord(best.w);
    const s3 = S();
    if (def && s3.lastPlay?.ts === res.state.lastPlay?.ts) room.setState({ ...s3, lastPlay: { ...s3.lastPlay, def } });
  }

  const mod = {
    id,
    init(r) { room = r; L = tvLayers(r.el); busy = null; },
    canStart() { return Object.values(room.seatInfo()).filter(Boolean).length >= 2; },
    startHint() { return "Scribble needs 2–4 players"; },
    start() {
      if (!mod.canStart()) return;
      busy = null;
      const res = startGame(S(), room.seatInfo(), room.now());
      room.setSecret(res.secret);
      pushRacks(res.secret);
      room.setState(res.state);
      room.sound("ready");
    },
    onPlayersChanged() {
      if (!room.state) return;
      const s = S();
      if (s.phase === "lobby") return;
      const seats = room.seatInfo();
      let changed = false;
      const names = { ...s.names };
      for (const x of s.order) if (seats[x] && names[x] !== seats[x].name) { names[x] = seats[x].name; changed = true; }
      if (changed) room.setState({ ...s, names });
    },
    onSeatTransfer(oldUid, newUid, seat) {
      const r = room.secret?.racks?.[seat];
      if (r != null) room.setPrivate(newUid, "rack", r);
    },
    onAction(uid, a) {
      if (handleEmote(room, L, lastEmoteAt, uid, a)) return;
      const seat = room.seatOf(uid);
      if (!seat) return;
      const s = S(), t = room.now();
      const notice = (text) => room.setPrivate(uid, "notice", { text, ts: t });
      if (a.type === "again") { if (s.phase === "gameOver") mod.start(); return; }
      if (!s.order.includes(seat)) return;
      if (a.type === "play") { play(uid, seat, Object.values(a.payload?.tiles || {})); return; }
      if (busy) return notice("Still checking your last word…");
      if (a.type === "swap") {
        const res = swapTiles(s, SEC(), seat, a.payload?.letters, t);
        if (res.error) return notice(res.error);
        room.setPrivate(uid, "notice", null);
        apply(res, [seat]);
      } else if (a.type === "pass") {
        const res = passTurn(s, SEC(), seat, t);
        if (res.error) return notice(res.error);
        apply(res, []);
      } else if (a.type === "sync") {
        const r = room.secret?.racks?.[seat];
        if (r != null) room.setPrivate(uid, "rack", r);
      }
    },
    tick(t) {
      if (!room?.state) return;
      const s = S();
      if (s.phase !== "playing") return;
      if (!busy) {
        const timeUp = s.timerEndsAt && t >= s.timerEndsAt;
        if (away(s.turn)) awaySince[s.turn] ??= t; else delete awaySince[s.turn];
        const gone = awaySince[s.turn] != null && t - awaySince[s.turn] > AWAY_MS && t - (s.turnAt || 0) > AWAY_MS;
        if (timeUp || gone) { apply(passTurn(s, SEC(), s.turn, t, timeUp ? "timeout" : "away"), []); return; }
      } else if (t - busy.at > 15000) busy = null; // safety valve
      tickSound(room, s.timerEndsAt, t, tickMemo);
      updateRing(L.screen, s.timerEndsAt, TURN_MS, t);
    },
    render(state) {
      if (!L) return;
      const s = normalizeState(state), T = room.theme, sk = skin(T);
      if (s.phase === "playing") {
        const l = s.lastPlay;
        const status = s.checking ? `Checking ${esc(nm(s, s.checking))}'s words…` : `${esc(nm(s, s.turn))}'s turn`;
        const bounce = s.bounce && (!s.last || s.bounce.ts > s.last.ts) ? `<div class="sc-bounce">✘ ${esc(s.bounce.words.join(", "))} ${s.bounce.words.length > 1 ? "aren't words" : "isn't a word"}</div>` : "";
        const note = s.last && s.last.type !== "play" ? `<div class="sc-note">${esc(lastText(s))}</div>` : "";
        const lastCard = l
          ? `<div class="sc-card"><div class="who">${esc(nm(s, l.by))} played</div>
              ${l.words.map((w) => `<div class="sc-w"><span>${esc(w.w)}</span><b>+${w.s}</b></div>`).join("")}
              ${l.bingo ? `<div class="sc-w bingo"><span>All 7 tiles!</span><b>+${BINGO}</b></div>` : ""}
              <div class="sc-total">${l.words.length > 1 || l.bingo ? `= +${l.total}` : ""}${l.unchecked ? ' <small>(dictionary offline, not checked)</small>' : ""}</div>
              ${l.def ? `<div class="sc-def"><b>${esc(l.def.word)}</b>${l.def.pos ? ` <i>${esc(l.def.pos)}</i>` : ""}: ${esc(l.def.text)}<div class="credit">Definitions by WordSoHard (wordsohard.com)</div></div>` : ""}</div>`
          : `<div class="sc-card"><div class="who">First word must cover the ★</div></div>`;
        L.screen.innerHTML = `<div class="sc-tv">
          ${boardHTML(s.board, { hot: l ? l.cells : [], cls: l && l.ts !== poppedTs ? "pop" : "" })}
          <div class="sc-side">
            <header class="sc-head"><div class="bs-title sm">${esc(sk.title)}</div>${ringHTML()}</header>
            <div class="sc-status ${s.checking ? "checking" : ""}">${status}</div>
            ${scoresHTML(s)}
            <div class="sc-bag">🎒 ${s.bag} tile${s.bag === 1 ? "" : "s"} in the bag</div>
            ${bounce}${note}${lastCard}
          </div></div>`;
        poppedTs = l?.ts ?? null;
        updateRing(L.screen, s.timerEndsAt, TURN_MS, room.now());
        return;
      }
      if (s.phase === "gameOver") {
        const top = leaders(s), best = s.scores[top[0]] || 0;
        const winners = top.filter((x) => (s.scores[x] || 0) === best).map((x) => nm(s, x));
        const how = s.outBy ? `${nm(s, s.outBy)} used every tile` : "Nobody could score, so the game ended";
        L.screen.innerHTML = `<div class="sc-tv over">
          ${boardHTML(s.board, { cls: "small" })}
          <div class="sc-side">
            <h1 class="bs-win">${esc(winners.join(" & "))} ${winners.length > 1 ? "WIN" : "WINS"}!</h1>
            <p class="hint">${esc(how)}. Leftover tiles count against you.</p>
            ${scoresHTML(s, { final: true })}
            <p class="hint">Any player can tap Play again on their phone.</p>
            <div class="over-ctl"><button class="btn" data-act="again" data-key="again">Play again</button></div>
            ${overControlsHTML(T)}
            <p class="sc-credit">${esc(CREDIT)}</p>
          </div></div>`;
        L.screen.querySelector('[data-act="again"]').addEventListener("click", () => mod.start());
        wireOverControls(L.screen, room, '[data-act="again"]');
      }
    },
  };
  return mod;
}

/* ---------------------------------------------------------------- phone */

export function createPhone() {
  let ctx = null, v = null, prev = null, stopTimer = null, noticeSeen = 0, synced = false;
  // local tile arrangement
  let rack = "", order = [], staged = [], sel = null, swapping = null, blankAt = null, sent = 0, passArm = 0, localMsg = "";
  const seatOf = () => (/^p\d$/.test(v?.me?.role || "") ? v.me.role : null);

  function resetRack(r) {
    rack = r;
    order = [...r].map((_, k) => k);
    staged = []; sel = null; swapping = null; blankAt = null;
  }
  const usedK = () => new Set(staged.map((t) => t.k));
  const tilesPayload = () => staged.map((t) => ({ i: t.i, l: rack[t.k], ...(t.as ? { as: t.as } : {}) }));

  function feedback(s, seat) {
    if (prev && seat) {
      if (s.turn !== prev.turn) localMsg = "";
      if (s.phase === "playing" && s.turn === seat && prev.turn !== seat) { ctx.sound("turn"); ctx.vibrate(80); }
      if (s.last && prev.lastTs !== s.last.ts && s.last.by !== seat && s.last.type === "play") ctx.sound("hit", { volume: 0.5 });
      if (s.phase === "gameOver" && prev.phase !== "gameOver") { const top = leaders(s)[0]; ctx.sound(s.scores[seat] === s.scores[top] ? "win" : "lose"); }
    }
    prev = { turn: s.turn, phase: s.phase, lastTs: s.last?.ts };
  }

  function draw() {
    const el = ctx.el, s = normalizeState(v.state), T = v.theme, seat = seatOf();
    const inGame = seat && s.order.includes(seat);
    const mine = inGame && s.phase === "playing" && s.turn === seat;
    if (!mine) sent = 0;
    const waiting = mine && (s.checking === seat || (sent && Date.now() - sent < 8000));
    // drop staged tiles whose squares got filled
    staged = staged.filter((t) => s.board[t.i] === ".");
    const myScore = inGame ? `<span class="badge">${esc(nm(s, seat))} · ${s.scores[seat] || 0} pts · 🎒 ${s.bag}</span>` : '<div class="badge">👀 Spectating</div>';
    if (!inGame) {
      el.innerHTML = `<div class="pb sc-phone">${myScore}
        <div class="pb-status"><span class="t">${esc(nm(s, s.turn))}'s turn</span><span class="timer"></span></div>
        ${boardHTML(s.board, { hot: s.lastPlay?.cells || [] })}${scoresHTML(s)}${emoteBarHTML(T)}</div>`;
      wireEmotes(el, ctx);
      stopTimer = phoneTimer(el, ctx, () => normalizeState(v.state).timerEndsAt);
      return;
    }
    const n = v.priv?.notice;
    const fresh = n && n.ts > noticeSeen ? n : null;
    if (fresh) { noticeSeen = n.ts; sent = 0; if (ctx.now() - n.ts < 15000) localMsg = fresh.text; }
    const stagedMap = Object.fromEntries(staged.map((t) => [t.i, t.as ? t.as.toLowerCase() : rack[t.k]]));
    let preview = "", previewBad = false;
    if (staged.length) {
      const ev = evaluatePlay(s.board, rack, tilesPayload());
      if (ev.error) { preview = ev.error; previewBad = true; } else preview = `${ev.words.map((w) => w.w).join(", ")} · +${ev.total}${ev.bingo ? " (all 7!)" : ""}`;
    }
    const used = usedK();
    const rackHTML = order.map((k) => {
      if (used.has(k)) return '<span class="sc-rt gone"></span>';
      const cls = swapping ? (swapping.has(k) ? "marked" : "") : sel === k ? "sel" : "";
      return tileHTML(rack[k], `data-k="${k}"`, cls + (rack[k] === "?" ? " blank" : ""));
    }).join("");
    const status = waiting ? "Checking your words…" : mine ? "YOUR TURN!" : `${esc(nm(s, s.turn))}${s.checking ? " is being checked…" : " is thinking…"}`;
    let actions;
    if (swapping) {
      actions = `<div class="ph-actions"><button class="btn" data-act="doSwap" ${swapping.size ? "" : "disabled"}>Swap ${swapping.size || ""}</button><button class="btn ghost" data-act="cancelSwap">Cancel</button></div>
        <p class="sub">Tap the tiles you want to trade in. Swapping uses your turn.</p>`;
    } else if (mine) {
      actions = `<div class="ph-actions"><button class="btn" data-act="play" ${staged.length && !waiting ? "" : "disabled"}>Play</button><button class="btn ghost" data-act="recall" ${staged.length ? "" : "disabled"}>Recall</button></div>
        <div class="ph-actions sc-small"><button class="btn ghost" data-act="shuffle">🔀 Shuffle</button><button class="btn ghost" data-act="swap" ${s.bag && !waiting ? "" : "disabled"}>Swap</button><button class="btn ghost" data-act="pass" ${waiting ? "disabled" : ""}>${Date.now() - passArm < 3000 ? "Tap to pass" : "Pass"}</button></div>`;
    } else {
      actions = `<div class="ph-actions sc-small"><button class="btn ghost" data-act="recall" ${staged.length ? "" : "disabled"}>Recall</button><button class="btn ghost" data-act="shuffle">🔀 Shuffle</button></div>`;
    }
    const lastLine = s.last ? lastText(s) : "First word must cover the ★";
    el.innerHTML = `<div class="pb sc-phone ${mine ? "mine" : "theirs"}">${myScore}
      <div class="pb-status"><span class="t">${status}</span><span class="timer"></span></div>
      ${boardHTML(s.board, { staged: stagedMap, hot: s.lastPlay?.cells || [], tap: true })}
      <p class="sc-preview ${previewBad ? "bad" : ""}">${esc(preview || lastLine)}</p>
      <div class="sc-rack">${rackHTML}</div>
      ${actions}
      <p class="msg ${localMsg ? "bad" : ""}">${esc(localMsg)}</p>
      ${mine ? "" : emoteBarHTML(T)}
      ${blankAt != null ? `<div class="sc-pick"><div class="box"><p>Which letter is the blank?</p><div class="keys">${[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c) => `<button class="hm-key" data-as="${c}">${c}</button>`).join("")}</div><button class="btn ghost" data-act="noBlank">Cancel</button></div></div>` : ""}
    </div>`;
    wire(el, s, mine, waiting);
    if (!mine) wireEmotes(el, ctx);
    stopTimer = phoneTimer(el, ctx, () => normalizeState(v.state).timerEndsAt);
  }

  function wire(el, s, mine, waiting) {
    const redraw = () => { stopTimer?.(); draw(); };
    el.querySelectorAll(".sc-rack .sc-rt[data-k]").forEach((b) => b.addEventListener("click", () => {
      const k = Number(b.dataset.k);
      if (swapping) { swapping.has(k) ? swapping.delete(k) : swapping.add(k); }
      else sel = sel === k ? null : k;
      redraw();
    }));
    el.querySelectorAll(".sc-board.tap .sc-cell").forEach((c) => c.addEventListener("click", () => {
      if (swapping) return;
      const i = Number(c.dataset.i);
      const at = staged.findIndex((t) => t.i === i);
      if (at >= 0) { staged.splice(at, 1); localMsg = ""; redraw(); return; }
      if (s.board[i] !== ".") return;
      if (sel == null) {
        // tap an empty square with nothing selected: grab the first free tile
        const free = order.find((k) => !usedK().has(k));
        if (free == null) return;
        sel = free;
      }
      staged.push({ i, k: sel });
      if (rack[sel] === "?") blankAt = i;
      sel = null;
      localMsg = "";
      ctx.vibrate(15);
      redraw();
    }));
    el.querySelectorAll(".sc-pick [data-as]").forEach((b) => b.addEventListener("click", () => {
      const t = staged.find((x) => x.i === blankAt);
      if (t) t.as = b.dataset.as;
      blankAt = null;
      redraw();
    }));
    const act = (name, fn) => el.querySelector(`[data-act="${name}"]`)?.addEventListener("click", fn);
    act("noBlank", () => { staged = staged.filter((x) => x.i !== blankAt); blankAt = null; redraw(); });
    act("recall", () => { staged = []; sel = null; redraw(); });
    act("shuffle", () => { order = [...order].sort(() => Math.random() - 0.5); redraw(); });
    act("play", () => {
      if (!mine || waiting) return;
      const ev = evaluatePlay(s.board, rack, tilesPayload());
      if (ev.error) { localMsg = ev.error; ctx.sound("error"); redraw(); return; }
      sent = Date.now();
      ctx.send("play", { tiles: tilesPayload() });
      redraw();
    });
    act("swap", () => { staged = []; sel = null; swapping = new Set(); redraw(); });
    act("cancelSwap", () => { swapping = null; redraw(); });
    act("doSwap", () => {
      if (!swapping?.size) return;
      ctx.send("swap", { letters: [...swapping].map((k) => rack[k]).join("") });
      swapping = null;
      redraw();
    });
    act("pass", () => {
      if (Date.now() - passArm < 3000) { passArm = 0; staged = []; ctx.send("pass"); redraw(); return; }
      passArm = Date.now();
      redraw();
      setTimeout(() => { if (passArm && Date.now() - passArm >= 3000) redraw(); }, 3100);
    });
  }

  return {
    mount(c) { ctx = c; resetRack(""); synced = false; },
    unmount() { stopTimer?.(); stopTimer = null; },
    render(view) {
      v = view;
      const el = ctx.el, s = normalizeState(view.state), T = view.theme, seat = seatOf();
      stopTimer?.();
      feedback(s, seat);
      const r = view.priv?.rack ?? "";
      if (r !== rack) resetRack(r); // a bounced play keeps the same rack, so staged tiles survive
      if (s.phase === "playing" && seat && s.order.includes(seat) && !r && !synced) { synced = true; ctx.send("sync"); }
      if (s.phase === "playing") { draw(); return; }
      if (s.phase === "gameOver") {
        const top = leaders(s);
        const inGame = seat && s.order.includes(seat);
        const won = inGame && (s.scores[seat] || 0) === (s.scores[top[0]] || 0);
        el.innerHTML = `<div class="po ${won ? "won" : "lost"}">
          <h1 class="big">${won ? "YOU WIN!" : `${esc(nm(s, top[0]))} WINS`}</h1>
          ${scoresHTML(s, { final: true })}
          ${inGame && s.leftover?.[seat] ? `<p class="sub">Your leftover tiles: ${esc(s.leftover[seat].replace(/\?/g, "□"))}</p>` : ""}
          ${seat ? '<button class="btn huge" data-act="again">🔁 Play again</button>' : ""}${emoteBarHTML(T)}</div>`;
        el.querySelector('[data-act="again"]')?.addEventListener("click", () => { ctx.send("again"); ctx.sound("ready"); });
        wireEmotes(el, ctx);
        return;
      }
      el.innerHTML = `<div class="pw"><h1>${esc(skin(T).title)}</h1><p class="sub">Waiting for the game to start…</p>${emoteBarHTML(T)}</div>`;
      wireEmotes(el, ctx);
    },
  };
}
