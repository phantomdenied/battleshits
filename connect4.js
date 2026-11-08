// connect4.js — Connect 4 game module. Pure engine + TV view + phone view.
// Board is a 42-char string, row 0 at the top: "." empty, "1" = p1, "2" = p2.
import { fmt } from "./themes.js";
import { esc, arr, tvLayers, handleEmote, ringHTML, updateRing, tickSound, overControlsHTML, wireOverControls, emoteBarHTML, wireEmotes, phoneTimer } from "./kit.js";

export const id = "connect4";
export const ROWS = 6, COLS = 7;
export const TURN_MS = 20000;
const other = (s) => (s === "p1" ? "p2" : "p1");
const ch = (seat) => (seat === "p1" ? "1" : "2");

const SKIN = {
  classic: {
    title: "Connect 4", tagline: "Four in a row wins", disc: { p1: "", p2: "" }, win: "{name} CONNECTS FOUR!",
    yourTurn: "YOUR TURN — DROP A DISC", theirTurn: "{name} is thinking…", auto: "Too slow! Auto-drop", draw: "IT'S A DRAW",
  },
  shit: {
    title: "Connect Plop", tagline: "Four turds in a row", disc: { p1: "💩", p2: "🧻" }, win: "{name} CLOGGED IT!",
    yourTurn: "YOUR TURN — DROP ONE", theirTurn: "{name} is pushing…", auto: "Took too long! Auto-plop", draw: "BACKED UP — DRAW",
  },
};
const skin = (T) => SKIN[T.id] || SKIN.classic;

/* ---------------------------------------------------------------- engine */

export function initialState() {
  return {
    game: id, phase: "lobby", round: 0, board: ".".repeat(ROWS * COLS), turn: "p1", starter: "p1",
    last: null, winLine: [], winner: null, tally: { p1: 0, p2: 0, draw: 0 }, rematch: { p1: false, p2: false },
    timerEndsAt: null, seats: { p1: null, p2: null },
  };
}
export function normalizeState(s) {
  const b = initialState();
  if (!s) return b;
  const n = { ...b, ...s, game: id };
  n.board = typeof s.board === "string" && s.board.length === ROWS * COLS ? s.board : b.board;
  n.winLine = arr(s.winLine).map(Number);
  n.tally = { p1: s.tally?.p1 || 0, p2: s.tally?.p2 || 0, draw: s.tally?.draw || 0 };
  n.rematch = { p1: !!s.rematch?.p1, p2: !!s.rematch?.p2 };
  n.seats = { p1: s.seats?.p1 || null, p2: s.seats?.p2 || null };
  for (const k of ["last", "winner", "timerEndsAt"]) n[k] = s[k] ?? null;
  return n;
}

export function startRound(s, now) {
  const round = (s.round || 0) + 1;
  const starter = round % 2 === 1 ? "p1" : "p2";
  return { ...s, phase: "play", round, board: ".".repeat(ROWS * COLS), turn: starter, starter, last: null, winLine: [], winner: null, rematch: { p1: false, p2: false }, timerEndsAt: now + TURN_MS };
}
export const dropRow = (board, c) => { for (let r = ROWS - 1; r >= 0; r--) if (board[r * COLS + c] === ".") return r; return -1; };
export const openCols = (board) => [...Array(COLS).keys()].filter((c) => board[c] === ".");

/** Winning line through cell idx (4+ in a row), or []. */
export function findLine(board, idx) {
  const who = board[idx];
  if (who === ".") return [];
  const r0 = Math.floor(idx / COLS), c0 = idx % COLS;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [idx];
    for (const sgn of [1, -1]) {
      let r = r0 + dr * sgn, c = c0 + dc * sgn;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === who) { line.push(r * COLS + c); r += dr * sgn; c += dc * sgn; }
    }
    if (line.length >= 4) return line.sort((a, b) => a - b);
  }
  return [];
}

export function move(s, seat, c, now, auto = false) {
  if (s.phase !== "play") return { error: "Not playing right now" };
  if (seat !== s.turn) return { error: "Not your turn" };
  if (!Number.isInteger(c) || c < 0 || c >= COLS) return { error: "Bad column" };
  const r = dropRow(s.board, c);
  if (r < 0) return { error: "That column is full" };
  const idx = r * COLS + c;
  const board = s.board.slice(0, idx) + ch(seat) + s.board.slice(idx + 1);
  const last = { r, c, by: seat, ts: now, auto: !!auto };
  const line = findLine(board, idx);
  if (line.length) {
    const tally = { ...s.tally, [seat]: s.tally[seat] + 1 };
    return { state: { ...s, board, last, winLine: line, winner: seat, phase: "gameOver", tally, timerEndsAt: null }, event: { win: seat, auto } };
  }
  if (!board.includes(".")) {
    return { state: { ...s, board, last, winner: "draw", phase: "gameOver", tally: { ...s.tally, draw: s.tally.draw + 1 }, timerEndsAt: null }, event: { draw: true, auto } };
  }
  return { state: { ...s, board, last, turn: other(seat), timerEndsAt: now + TURN_MS }, event: { auto } };
}
export function timeoutMove(s, now, rng = Math.random) {
  const cols = openCols(s.board);
  return move(s, s.turn, cols[Math.floor(rng() * cols.length)], now, true);
}
export function requestRematch(s, seat, now) {
  if (s.phase !== "gameOver") return { error: "Game isn't over" };
  const rematch = { ...s.rematch, [seat]: true };
  if (rematch.p1 && rematch.p2) return { state: startRound({ ...s, rematch }, now), restarted: true };
  return { state: { ...s, rematch } };
}

/* -------------------------------------------------------------- render */

const name = (s, seat) => s.seats?.[seat]?.name || (seat === "p1" ? "Player 1" : "Player 2");

function boardHTML(s, T, { tap = false, fresh = false, cls = "" } = {}) {
  const sk = skin(T);
  const win = new Set(s.winLine);
  let cells = "";
  for (let i = 0; i < ROWS * COLS; i++) {
    const v = s.board[i];
    const r = Math.floor(i / COLS), c = i % COLS;
    const seat = v === "1" ? "p1" : v === "2" ? "p2" : null;
    const isFresh = fresh && s.last && s.last.r === r && s.last.c === c;
    cells += `<div class="c4-cell" data-c="${c}">${seat ? `<span class="c4-disc ${seat} ${win.has(i) ? "win" : ""} ${isFresh ? "drop" : ""}" style="--r:${r + 1}">${sk.disc[seat]}</span>` : ""}</div>`;
  }
  const cols = tap ? `<div class="c4-cols">${[...Array(COLS).keys()].map((c) => `<button class="c4-col" data-c="${c}" ${s.board[c] !== "." ? "disabled" : ""} aria-label="Column ${c + 1}"></button>`).join("")}</div>` : "";
  return `<div class="c4-board ${cls}">${cells}${cols}</div>`;
}
const tallyHTML = (s) => `<div class="tally"><span>${esc(name(s, "p1"))}</span><b>${s.tally.p1}</b><i>—</i><b>${s.tally.p2}</b><span>${esc(name(s, "p2"))}</span>${s.tally.draw ? `<i>(${s.tally.draw} draw${s.tally.draw > 1 ? "s" : ""})</i>` : ""}</div>`;
const chip = (seat, T) => `<span class="c4-disc mini ${seat}">${skin(T).disc[seat]}</span>`;

/* ------------------------------------------------------------------- TV */

export function createHost() {
  let room = null, L = null;
  const lastEmoteAt = {}, tickMemo = {};
  let lastKey = null;
  const S = () => normalizeState(room.state);

  function commit(res) {
    if (!res || res.error) return;
    room.setState(res.state);
    const T = room.theme, sk = skin(T), ev = res.event;
    room.sound("place");
    if (ev.auto) L.flash(sk.auto, "miss");
    if (ev.win) { setTimeout(() => { room.sound("sunk"); L.shake(); }, 250); setTimeout(() => room.sound("win"), 1300); }
    if (ev.draw) setTimeout(() => room.sound("lose"), 400);
  }

  const mod = {
    id,
    init(r) { room = r; L = tvLayers(r.el); },
    canStart() { const s = room.seatInfo(); return !!(s.p1 && s.p2); },
    startHint() { return "Connect 4 needs Player 1 and Player 2"; },
    start() { if (mod.canStart()) { room.setState(startRound({ ...S(), seats: room.seatInfo() }, room.now())); room.sound("ready"); } },
    onPlayersChanged() {
      if (!room.state) return;
      const s = S(), seats = room.seatInfo();
      if (JSON.stringify(seats) !== JSON.stringify(s.seats)) room.setState({ ...s, seats });
    },
    onSeatTransfer() {},
    onAction(uid, a) {
      if (handleEmote(room, L, lastEmoteAt, uid, a)) return;
      const seat = room.seatOf(uid);
      if (!seat) return;
      const s = S();
      if (a.type === "drop") {
        const res = move(s, seat, Number(a.payload?.c), room.now());
        if (res.error) { room.setPrivate(uid, "notice", { text: res.error, ts: room.now() }); return; }
        commit(res);
      } else if (a.type === "rematch") {
        const res = requestRematch(s, seat, room.now());
        if (!res.error) { room.setState(res.state); room.sound(res.restarted ? "turn" : "ready"); }
      }
    },
    tick(t) {
      if (!room?.state) return;
      const s = S();
      if (s.phase !== "play") return;
      if (s.timerEndsAt && t >= s.timerEndsAt) { commit(timeoutMove(s, t)); return; }
      tickSound(room, s.timerEndsAt, t, tickMemo);
      updateRing(L.screen, s.timerEndsAt, TURN_MS, t);
    },
    render(state) {
      if (!L) return;
      const s = normalizeState(state), T = room.theme, sk = skin(T);
      const key = s.last ? `${s.round}:${s.last.r}:${s.last.c}` : null;
      const fresh = key && key !== lastKey;
      lastKey = key;
      if (s.phase === "play") {
        L.screen.innerHTML = `<div class="c4-tv">
          <header class="bs-top"><div class="bs-title sm">${esc(sk.title)}</div>
            <div class="bs-banner">${chip(s.turn, T)} ${esc(name(s, s.turn))}'s turn</div>${ringHTML()}</header>
          <div class="c4-main">
            <div class="c4-side ${s.turn === "p1" ? "on" : ""}">${chip("p1", T)}<b>${esc(name(s, "p1"))}</b></div>
            ${boardHTML(s, T, { fresh })}
            <div class="c4-side ${s.turn === "p2" ? "on" : ""}">${chip("p2", T)}<b>${esc(name(s, "p2"))}</b></div>
          </div>${tallyHTML(s)}</div>`;
        updateRing(L.screen, s.timerEndsAt, TURN_MS, room.now());
        return;
      }
      if (s.phase === "gameOver") {
        const head = s.winner === "draw" ? sk.draw : fmt(sk.win, { name: name(s, s.winner) });
        const rm = (seat) => `<span class="rm ${s.rematch[seat] ? "yes" : ""}">${esc(name(s, seat))}: ${s.rematch[seat] ? "✅ ready" : "…"}</span>`;
        L.screen.innerHTML = `<div class="c4-tv over">
          <h1 class="bs-win">${esc(head)}</h1>
          <div class="c4-main">${boardHTML(s, T, { fresh, cls: "small" })}</div>
          ${tallyHTML(s)}
          <div class="rm-row">${rm("p1")}${rm("p2")}</div>
          ${overControlsHTML(T, "Next round theme:")}</div>`;
        wireOverControls(L.screen, room);
      }
    },
  };
  return mod;
}

/* ---------------------------------------------------------------- phone */

export function createPhone() {
  let ctx = null, v = null, prev = null, pending = null, stopTimer = null, lastKey = null;
  const seatOf = () => (v?.me?.role === "p1" || v?.me?.role === "p2" ? v.me.role : null);

  function feedback(s, seat) {
    if (prev && seat) {
      if (s.phase === "play" && s.turn === seat && (prev.turn !== seat || prev.phase !== "play")) { ctx.sound("turn"); ctx.vibrate(60); }
      if (s.last && (!prev.last || prev.last.ts !== s.last.ts) && s.last.by !== seat) ctx.sound("place", { volume: 0.6 });
      if (s.phase === "gameOver" && prev.phase !== "gameOver") setTimeout(() => ctx.sound(s.winner === seat ? "win" : "lose"), 500);
    }
    prev = { turn: s.turn, phase: s.phase, last: s.last };
  }

  return {
    mount(c) { ctx = c; },
    unmount() { stopTimer?.(); stopTimer = null; },
    render(view) {
      v = view;
      const el = ctx.el, s = normalizeState(view.state), T = view.theme, sk = skin(T), seat = seatOf();
      feedback(s, seat);
      stopTimer?.();
      const key = s.last ? `${s.round}:${s.last.r}:${s.last.c}` : null;
      const fresh = key && key !== lastKey;
      lastKey = key;
      if (pending && (s.last?.ts > pending.at - 5000 && s.last?.by === seat || Date.now() - pending.at > 4000 || s.turn !== seat)) pending = null;
      if (s.phase === "play") {
        const mine = seat && s.turn === seat;
        const status = !seat ? `${name(s, s.turn)}'s turn` : mine ? sk.yourTurn : fmt(sk.theirTurn, { name: name(s, other(seat)) });
        el.innerHTML = `<div class="pb c4p ${mine ? "mine" : "theirs"}">
          ${seat ? "" : '<div class="badge">👀 Spectating</div>'}
          <div class="pb-status"><span class="t">${seat ? chip(seat, T) : ""} ${esc(status)}</span><span class="timer"></span></div>
          ${boardHTML(s, T, { tap: mine && !pending, fresh })}
          <p class="sub">${mine ? "Tap a column to drop your disc" : ""}</p>
          ${tallyHTML(s)}${emoteBarHTML(T)}</div>`;
        el.querySelectorAll(".c4-col").forEach((b) => b.addEventListener("click", () => {
          if (pending || b.disabled) { ctx.sound("error"); return; }
          pending = { c: +b.dataset.c, at: Date.now() };
          el.querySelectorAll(".c4-col").forEach((x) => { x.disabled = true; });
          b.classList.add("aim");
          ctx.sound("place");
          ctx.send("drop", { c: pending.c });
        }));
        wireEmotes(el, ctx);
        stopTimer = phoneTimer(el, ctx, () => normalizeState(v.state).timerEndsAt);
        return;
      }
      if (s.phase === "gameOver") {
        const won = seat && s.winner === seat;
        const head = s.winner === "draw" ? sk.draw : !seat ? fmt(sk.win, { name: name(s, s.winner) }) : won ? "YOU WIN!" : "YOU LOSE";
        el.innerHTML = `<div class="po ${won || s.winner === "draw" ? "won" : "lost"}">
          <h1 class="big">${esc(head)}</h1>
          ${boardHTML(s, T, { cls: "mid" })}
          ${tallyHTML(s)}
          ${seat ? `<button class="btn huge" data-act="rematch" ${s.rematch[seat] ? "disabled" : ""}>${s.rematch[seat] ? "Waiting…" : "🔁 Play again"}</button>
          <p class="sub">${s.rematch[other(seat)] ? `${esc(name(s, other(seat)))} wants to play again!` : ""}</p>` : ""}
          ${emoteBarHTML(T)}</div>`;
        el.querySelector('[data-act="rematch"]')?.addEventListener("click", () => { ctx.send("rematch"); ctx.sound("ready"); });
        wireEmotes(el, ctx);
      }
    },
  };
}
