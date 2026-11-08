// hangman.js — Hangman for 2–8 players. Each round one player sets a word
// (typed or random); everyone else takes turns guessing letters or solving.
// Scoring: +1 per letter revealed, +3 for finishing the word, +2 per hidden
// letter for a correct solve; the setter gets +1 per wrong guess and +3 if the
// guessers run out of strikes. Everyone sets once per game.
import { fmt } from "./themes.js";
import { esc, arr, seatList, pick, tvLayers, handleEmote, ringHTML, updateRing, tickSound, overControlsHTML, wireOverControls, emoteBarHTML, wireEmotes, phoneTimer } from "./kit.js";

export const id = "hangman";
export const SEATS = seatList(8);
export const MAX_STRIKES = 6;
export const SET_MS = 60000, TURN_MS = 25000, ROUND_OVER_MS = 9000;
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const WORDS = [
  "PIZZA", "KARAOKE", "SPAGHETTI", "BUBBLEGUM", "TRAMPOLINE", "DINOSAUR", "PINEAPPLE", "SKATEBOARD", "HAMBURGER", "MARSHMALLOW",
  "ROLLER COASTER", "BIRTHDAY CAKE", "HOT TUB", "PILLOW FIGHT", "FIRE TRUCK", "SPACE STATION", "TREASURE CHEST", "HAUNTED HOUSE",
  "VAMPIRE", "ZOMBIE", "WEREWOLF", "UNICORN", "DRAGON", "PIRATE SHIP", "NINJA", "ROBOT", "WIZARD", "MERMAID", "ALIEN INVASION",
  "BASKETBALL", "FOOTBALL", "BOWLING ALLEY", "MINI GOLF", "SNOWBALL FIGHT", "WATER SLIDE", "CAMPFIRE", "SLEEPING BAG", "THUNDERSTORM",
  "HURRICANE", "VOLCANO", "EARTHQUAKE", "RAINBOW", "WATERFALL", "JUNGLE", "DESERT ISLAND", "NORTH POLE", "MOUNTAIN", "SUBMARINE",
  "HELICOPTER", "MOTORCYCLE", "BULLDOZER", "SPACESHIP", "HOT AIR BALLOON", "TRAFFIC JAM", "PARKING TICKET", "SPEED BUMP",
  "MICROWAVE", "REFRIGERATOR", "VACUUM CLEANER", "TOASTER", "WASHING MACHINE", "REMOTE CONTROL", "SMARTPHONE", "HEADPHONES",
  "SANDWICH", "BURRITO", "CHEESEBURGER", "FRENCH FRIES", "CHICKEN NUGGETS", "TACO TUESDAY", "ICE CREAM", "CHOCOLATE", "POPCORN",
  "PANCAKES", "WAFFLES", "BACON", "MEATBALL", "GUACAMOLE", "PEANUT BUTTER", "JELLY BEANS", "COTTON CANDY", "CUPCAKE",
  "GIRAFFE", "ELEPHANT", "PENGUIN", "KANGAROO", "OCTOPUS", "PLATYPUS", "HIPPOPOTAMUS", "RACCOON", "FLAMINGO", "SLOTH",
  "GOLDFISH", "HAMSTER", "GORILLA", "CROCODILE", "JELLYFISH", "PORCUPINE", "SKUNK", "LLAMA", "WALRUS", "BUMBLEBEE",
  "DANCE PARTY", "GAME NIGHT", "MOVIE THEATER", "MAGIC TRICK", "SURPRISE PARTY", "FAMILY REUNION", "ROAD TRIP", "FIRST DATE",
  "BAD HAIR DAY", "MONDAY MORNING", "LAUNDRY DAY", "SPRING CLEANING", "LOTTERY TICKET", "FORTUNE COOKIE", "WISHING WELL",
  "SNOWMAN", "SANDCASTLE", "SCARECROW", "JACK O LANTERN", "CHRISTMAS TREE", "FIREWORKS", "PIGGY BANK", "TIME MACHINE",
  "INVISIBLE", "SUPERHERO", "SECRET AGENT", "MAD SCIENTIST", "COWBOY", "ASTRONAUT", "LIFEGUARD", "FIREFIGHTER", "BALLERINA",
];
const SHIT_WORDS = [
  "TOILET PAPER", "PLUNGER", "BUBBLE BATH", "WHOOPEE CUSHION", "CLOGGED DRAIN", "PORTA POTTY", "STINK BOMB", "BEAN BURRITO",
  "PRUNE JUICE", "SEPTIC TANK", "RUBBER DUCKY", "AIR FRESHENER", "BATHROOM BREAK", "DIAPER", "FLUSH", "SEWER RAT", "GAS STATION RESTROOM",
];

const SKIN = {
  classic: { title: "Hangman", lose: "HANGED!", win: "SOLVED!", setter: "{name} is choosing a word…" },
  shit: { title: "Flushman", lose: "FLUSHED!", win: "SAVED FROM THE BOWL!", setter: "{name} is on the throne, picking a word…" },
};
const skin = (T) => SKIN[T.id] || SKIN.classic;

/* ---------------------------------------------------------------- engine */

/** Clean a typed word/phrase. Returns the cleaned word or { error }. */
export function cleanWord(raw) {
  const w = String(raw || "").toUpperCase().replace(/[^A-Z '\-]/g, "").replace(/\s+/g, " ").trim();
  const letters = w.replace(/[^A-Z]/g, "");
  if (letters.length < 3) return { error: "Use at least 3 letters" };
  if (w.length > 30) return { error: "Keep it under 30 characters" };
  if (w.split(" ").length > 4) return { error: "Four words max" };
  return { word: w };
}
export const maskOf = (word, guessed) => [...word].map((c) => (/[A-Z]/.test(c) && !guessed.includes(c) ? "_" : c)).join("");
export const randomWord = (themeId, rng = Math.random) => pick(themeId === "shit" && rng() < 0.4 ? SHIT_WORDS : WORDS, rng);

export function initialState() {
  return {
    game: id, phase: "lobby", round: 0, order: [], setter: null, turn: null, mask: "", guessed: "", wrong: "", strikes: 0,
    scores: {}, names: {}, last: null, word: null, outcome: null, roundPts: {}, timerEndsAt: null, game_no: 0,
  };
}
export function normalizeState(s) {
  const b = initialState();
  if (!s) return b;
  const n = { ...b, ...s, game: id };
  n.order = arr(s.order);
  n.scores = { ...(s.scores || {}) };
  n.names = { ...(s.names || {}) };
  n.roundPts = { ...(s.roundPts || {}) };
  for (const k of ["setter", "turn", "last", "word", "outcome", "timerEndsAt"]) n[k] = s[k] ?? null;
  for (const k of ["mask", "guessed", "wrong"]) n[k] = s[k] || "";
  return n;
}
/** Guessers in turn order for this round, starting after the setter. */
export function guessersOf(s) {
  const i = s.order.indexOf(s.setter);
  return [...s.order.slice(i + 1), ...s.order.slice(0, i)];
}
const nextGuesser = (s, from, skip = () => false) => {
  const g = guessersOf(s);
  if (!g.length) return null;
  let i = g.indexOf(from);
  for (let k = 0; k < g.length; k++) {
    i = (i + 1) % g.length;
    if (!skip(g[i])) return g[i];
  }
  return g[(g.indexOf(from) + 1) % g.length];
};

/** Start a new game with the current seated players (seat -> name). */
export function startGame(s, seated, now) {
  const order = SEATS.filter((x) => seated[x]);
  const names = Object.fromEntries(order.map((x) => [x, seated[x].name]));
  const scores = Object.fromEntries(order.map((x) => [x, 0]));
  return startSetting({ ...s, order, names, scores, round: 0, game_no: (s.game_no || 0) + 1 }, now);
}
export function startSetting(s, now) {
  const round = (s.round || 0) + 1;
  const setter = s.order[(round - 1) % s.order.length];
  return { ...s, phase: "setting", round, setter, turn: null, mask: "", guessed: "", wrong: "", strikes: 0, last: null, word: null, outcome: null, roundPts: {}, autoWord: false, timerEndsAt: now + SET_MS };
}
export function setWord(s, seat, raw, now) {
  if (s.phase !== "setting") return { error: "Not choosing a word right now" };
  if (seat !== s.setter) return { error: "It's not your turn to pick" };
  const c = cleanWord(raw);
  if (c.error) return c;
  const first = guessersOf(s)[0];
  return { state: { ...s, phase: "guessing", mask: maskOf(c.word, ""), turn: first, timerEndsAt: now + TURN_MS }, word: c.word };
}

function endRound(s, word, outcome, pts) {
  const scores = { ...s.scores };
  for (const [k, v] of Object.entries(pts)) scores[k] = (scores[k] || 0) + v;
  return { ...s, phase: "roundOver", mask: word, word, outcome, scores, roundPts: pts, turn: null, timerEndsAt: null };
}
const addPts = (pts, k, v) => ({ ...pts, [k]: (pts[k] || 0) + v });

/** Guess one letter. Correct letters keep the turn. */
export function guessLetter(s, word, seat, letter, now, skip) {
  if (s.phase !== "guessing") return { error: "Not guessing right now" };
  if (seat !== s.turn) return { error: "Not your turn" };
  const L = String(letter || "").toUpperCase();
  if (!/^[A-Z]$/.test(L)) return { error: "Pick a letter" };
  if (s.guessed.includes(L) || s.wrong.includes(L)) return { error: "Already guessed" };
  const count = [...word].filter((c) => c === L).length;
  let pts = { ...s.roundPts };
  if (count) {
    const guessed = s.guessed + L;
    const mask = maskOf(word, guessed);
    pts = addPts(pts, seat, count);
    const last = { by: seat, letter: L, ok: true, count, ts: now };
    if (!mask.includes("_")) return { state: endRound({ ...s, guessed, last }, word, "solved", addPts(pts, seat, 3)), event: last };
    return { state: { ...s, guessed, mask, last, roundPts: pts, timerEndsAt: now + TURN_MS }, event: last };
  }
  const strikes = s.strikes + 1;
  pts = addPts(pts, s.setter, 1);
  const last = { by: seat, letter: L, ok: false, ts: now };
  const st = { ...s, wrong: s.wrong + L, strikes, last, roundPts: pts };
  if (strikes >= MAX_STRIKES) return { state: endRound(st, word, "hanged", addPts(pts, s.setter, 3)), event: last };
  return { state: { ...st, turn: nextGuesser(s, seat, skip), timerEndsAt: now + TURN_MS }, event: last };
}
/** Try to solve the whole word. Wrong = a strike and the turn passes. */
export function solve(s, word, seat, text, now, skip) {
  if (s.phase !== "guessing") return { error: "Not guessing right now" };
  if (seat !== s.turn) return { error: "Not your turn" };
  const norm = (x) => String(x || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!norm(text)) return { error: "Type your answer" };
  if (norm(text) === norm(word)) {
    const hidden = [...s.mask].filter((c) => c === "_").length;
    const last = { by: seat, solve: true, ok: true, ts: now };
    return { state: endRound({ ...s, last }, word, "solved", addPts(s.roundPts, seat, 2 * hidden)), event: last };
  }
  const strikes = s.strikes + 1;
  const pts = addPts(s.roundPts, s.setter, 1);
  const last = { by: seat, solve: true, ok: false, text: String(text).toUpperCase().slice(0, 30), ts: now };
  const st = { ...s, strikes, last, roundPts: pts };
  if (strikes >= MAX_STRIKES) return { state: endRound(st, word, "hanged", addPts(pts, s.setter, 3)), event: last };
  return { state: { ...st, turn: nextGuesser(s, seat, skip), timerEndsAt: now + TURN_MS }, event: last };
}
/** Turn timer ran out (or the player left): pass the turn, no strike. */
export function passTurn(s, now, skip) {
  if (s.phase !== "guessing") return { error: "Not guessing" };
  return { state: { ...s, turn: nextGuesser(s, s.turn, skip), last: { by: s.turn, pass: true, ts: now }, timerEndsAt: now + TURN_MS } };
}
export function nextRound(s, now) {
  if (s.phase !== "roundOver") return { error: "Round isn't over" };
  if (s.round >= s.order.length) return { state: { ...s, phase: "gameOver", timerEndsAt: null } };
  return { state: startSetting(s, now) };
}
export const leaders = (s) => [...s.order].sort((a, b) => (s.scores[b] || 0) - (s.scores[a] || 0));

/* -------------------------------------------------------------- render */

const nm = (s, seat) => s.names?.[seat] || `Player ${String(seat || "").slice(1)}`;

/** Gallows (classic) or toilet (shit) drawing with `strikes` parts shown. */
function figureSVG(strikes, T) {
  const show = (n) => (strikes >= n ? "" : 'style="display:none"');
  const body = `<g class="hm-fig" stroke-linecap="round">
    <circle cx="150" cy="92" r="20" ${show(1)}/>
    <line x1="150" y1="112" x2="150" y2="170" ${show(2)}/>
    <line x1="150" y1="128" x2="124" y2="152" ${show(3)}/>
    <line x1="150" y1="128" x2="176" y2="152" ${show(4)}/>
    <line x1="150" y1="170" x2="130" y2="206" ${show(5)}/>
    <line x1="150" y1="170" x2="170" y2="206" ${show(6)}/></g>`;
  if (T.id === "shit") {
    const lvl = 250 - strikes * 26;
    return `<svg class="hm-svg" viewBox="0 0 240 280">
      <defs><clipPath id="bowl"><path d="M40 150 Q40 250 120 262 Q200 250 200 150 Z"/></clipPath></defs>
      <rect x="150" y="30" width="56" height="96" rx="8" class="hm-tank"/>
      <path d="M40 150 Q40 250 120 262 Q200 250 200 150 Z" class="hm-bowl"/>
      ${body.replace('class="hm-fig"', 'class="hm-fig" transform="translate(-30,40)"')}
      <rect x="30" y="${lvl}" width="180" height="${280 - lvl}" class="hm-water" clip-path="url(#bowl)"/>
      <ellipse cx="120" cy="150" rx="84" ry="16" class="hm-rim"/></svg>`;
  }
  return `<svg class="hm-svg" viewBox="0 0 240 280"><g class="hm-gallows" stroke-linecap="round">
    <line x1="30" y1="262" x2="200" y2="262"/><line x1="70" y1="262" x2="70" y2="30"/><line x1="66" y1="30" x2="154" y2="30"/>
    <line x1="70" y1="70" x2="108" y2="30"/><line x1="150" y1="30" x2="150" y2="72"/></g>${body}</svg>`;
}
function wordHTML(mask, cls = "") {
  return `<div class="hm-word ${cls}">${mask.split(" ").map((w) => `<span class="hm-w">${[...w].map((c) => `<span class="hm-tile ${c === "_" ? "" : "on"}">${c === "_" ? "" : esc(c)}</span>`).join("")}</span>`).join("")}</div>`;
}
function alphaHTML(s, { tap = false } = {}) {
  return `<div class="hm-alpha ${tap ? "tap" : ""}">${[...ALPHA].map((c) => {
    const st = s.guessed.includes(c) ? "ok" : s.wrong.includes(c) ? "bad" : "";
    return tap ? `<button class="hm-key ${st}" data-l="${c}" ${st ? "disabled" : ""}>${c}</button>` : `<span class="hm-key ${st}">${c}</span>`;
  }).join("")}</div>`;
}
function scoresHTML(s, { showRound = false } = {}) {
  return `<ol class="hm-scores">${leaders(s).map((x) => `<li class="${x === s.turn ? "turn" : ""} ${x === s.setter ? "setter" : ""}">
    <span class="n">${esc(nm(s, x))}${x === s.setter ? " ✍️" : ""}</span>
    ${showRound && s.roundPts[x] ? `<span class="plus">+${s.roundPts[x]}</span>` : ""}<b>${s.scores[x] || 0}</b></li>`).join("")}</ol>`;
}
function lastText(s) {
  const l = s.last;
  if (!l) return "";
  const who = nm(s, l.by);
  if (l.pass) return `${who} ran out of time`;
  if (l.solve) return l.ok ? `${who} solved it!` : `${who} guessed “${l.text}” — wrong!`;
  return l.ok ? `${who}: ${l.letter} ✔ ×${l.count}` : `${who}: ${l.letter} ✘`;
}

/* ------------------------------------------------------------------- TV */

export function createHost() {
  let room = null, L = null;
  const lastEmoteAt = {}, tickMemo = {};
  const S = () => normalizeState(room.state);
  const word = () => room.secret?.word || "";
  const skip = (seat) => { const u = room.uidForSeat(seat); return !u || !room.isOnline(u); };

  function commit(res) {
    if (!res || res.error) return;
    room.setState(res.state);
    const e = res.event, T = room.theme;
    if (!e) return;
    if (res.state.phase === "roundOver") {
      if (res.state.outcome === "solved") { room.sound("win"); L.flash(skin(T).win, "hit"); }
      else { room.sound("sunk"); L.flash(skin(T).lose, "sunk"); L.shake(); }
      return;
    }
    if (e.ok) room.sound("hit"); else { room.sound("miss"); L.shake(); }
  }

  const mod = {
    id,
    init(r) { room = r; L = tvLayers(r.el); },
    canStart() { return Object.values(room.seatInfo()).filter(Boolean).length >= 2; },
    startHint() { return "Hangman needs at least 2 players"; },
    start() {
      if (!mod.canStart()) return;
      room.setSecret({});
      room.setState(startGame(S(), room.seatInfo(), room.now()));
      room.sound("ready");
    },
    onPlayersChanged() {
      if (!room.state) return;
      const s = S();
      if (s.phase === "lobby") return;
      // keep display names fresh (seat swaps / reconnects)
      const seats = room.seatInfo();
      let changed = false;
      const names = { ...s.names };
      for (const x of s.order) if (seats[x] && names[x] !== seats[x].name) { names[x] = seats[x].name; changed = true; }
      if (changed) room.setState({ ...s, names });
    },
    onSeatTransfer() {},
    onAction(uid, a) {
      if (handleEmote(room, L, lastEmoteAt, uid, a)) return;
      const seat = room.seatOf(uid);
      if (!seat) return;
      const s = S(), t = room.now();
      const notice = (text) => room.setPrivate(uid, "notice", { text, ts: t });
      if (a.type === "setWord") {
        const raw = a.payload?.random ? randomWord(room.theme.id) : a.payload?.word;
        const res = setWord(s, seat, raw, t);
        if (res.error) return notice(res.error);
        room.setSecret({ word: res.word });
        room.setPrivate(uid, "word", res.word);
        room.setState(res.state);
        room.sound("turn");
      } else if (a.type === "guess") {
        const res = guessLetter(s, word(), seat, a.payload?.l, t, skip);
        if (res.error) return notice(res.error);
        commit(res);
      } else if (a.type === "solve") {
        const res = solve(s, word(), seat, a.payload?.text, t, skip);
        if (res.error) return notice(res.error);
        commit(res);
      } else if (a.type === "again") {
        if (s.phase === "gameOver") mod.start();
      }
    },
    tick(t) {
      if (!room?.state) return;
      const s = S();
      if (s.phase === "setting" && s.timerEndsAt && t >= s.timerEndsAt) {
        const res = setWord(s, s.setter, randomWord(room.theme.id), t);
        room.setSecret({ word: res.word });
        const u = room.uidForSeat(s.setter);
        if (u) room.setPrivate(u, "word", res.word);
        room.setState({ ...res.state, autoWord: true });
        room.sound("turn");
        return;
      }
      if (s.phase === "guessing") {
        if ((s.timerEndsAt && t >= s.timerEndsAt) || (skip(s.turn) && t > (s.timerEndsAt || 0) - TURN_MS + 4000)) {
          commit(passTurn(s, t, skip));
          return;
        }
      }
      if (s.phase === "roundOver") {
        const at = s.last?.ts || 0;
        if (t - at > ROUND_OVER_MS) { const res = nextRound(s, t); room.setState(res.state); room.sound(res.state.phase === "gameOver" ? "win" : "ready"); return; }
      }
      if (s.phase === "setting" || s.phase === "guessing") { tickSound(room, s.timerEndsAt, t, tickMemo); updateRing(L.screen, s.timerEndsAt, s.phase === "setting" ? SET_MS : TURN_MS, t); }
    },
    render(state) {
      if (!L) return;
      const s = normalizeState(state), T = room.theme, sk = skin(T);
      const head = (banner) => `<header class="bs-top"><div class="bs-title sm">${esc(sk.title)}</div><div class="bs-banner">${esc(banner)}</div>${ringHTML()}</header>`;
      if (s.phase === "setting") {
        L.screen.innerHTML = `<div class="hm-tv">${head(`Round ${s.round} of ${s.order.length}`)}
          <div class="hm-main"><div class="hm-left">${figureSVG(0, T)}</div>
            <div class="hm-center"><h2 class="hm-big">${esc(fmt(sk.setter, { name: nm(s, s.setter) }))}</h2><p class="hint">They're typing it on their phone. No peeking!</p></div>
            ${scoresHTML(s)}</div></div>`;
        updateRing(L.screen, s.timerEndsAt, SET_MS, room.now());
        return;
      }
      if (s.phase === "guessing" || s.phase === "roundOver") {
        const over = s.phase === "roundOver";
        const banner = over ? (s.outcome === "solved" ? sk.win : sk.lose) : `${nm(s, s.turn)}'s guess`;
        L.screen.innerHTML = `<div class="hm-tv ${over ? "over" : ""}">${head(banner)}
          <div class="hm-main"><div class="hm-left">${figureSVG(s.strikes, T)}<div class="hm-strikes">${"✘".repeat(s.strikes)}<span>${"✘".repeat(MAX_STRIKES - s.strikes)}</span></div></div>
            <div class="hm-center">${wordHTML(s.mask, over ? "reveal " + s.outcome : "")}
              <p class="hm-last">${esc(over ? `Set by ${nm(s, s.setter)}${s.autoWord ? " (random word)" : ""}` : lastText(s))}</p>
              ${alphaHTML(s)}</div>
            ${scoresHTML(s, { showRound: over })}</div></div>`;
        updateRing(L.screen, over ? null : s.timerEndsAt, TURN_MS, room.now());
        return;
      }
      if (s.phase === "gameOver") {
        const top = leaders(s);
        const best = s.scores[top[0]] || 0;
        const winners = top.filter((x) => (s.scores[x] || 0) === best).map((x) => nm(s, x));
        L.screen.innerHTML = `<div class="hm-tv over gameover">
          <h1 class="bs-win">${esc(winners.join(" & "))} ${winners.length > 1 ? "WIN" : "WINS"}!</h1>
          <div class="hm-final">${scoresHTML(s)}</div>
          <p class="hint">Any player can tap Play again on their phone.</p>
          <div class="over-ctl"><button class="btn" data-act="again" data-key="again">Play again</button></div>
          ${overControlsHTML(T)}</div>`;
        L.screen.querySelector('[data-act="again"]').addEventListener("click", () => mod.start());
        wireOverControls(L.screen, room, '[data-act="again"]');
      }
    },
  };
  return mod;
}

/* ---------------------------------------------------------------- phone */

export function createPhone() {
  let ctx = null, v = null, prev = null, pending = null, stopTimer = null, draft = "", solving = false, noticeSeen = 0;
  const seatOf = () => (/^p\d$/.test(v?.me?.role || "") ? v.me.role : null);

  function feedback(s, seat) {
    if (prev && seat) {
      if (s.phase === "guessing" && s.turn === seat && (prev.turn !== seat || prev.phase !== "guessing")) { ctx.sound("turn"); ctx.vibrate(60); }
      if (s.phase === "setting" && s.setter === seat && prev.phase !== "setting") { ctx.sound("turn"); ctx.vibrate(60); }
      if (s.last && prev.lastTs !== s.last.ts && !s.last.pass && s.last.by !== seat) ctx.sound(s.last.ok ? "hit" : "miss", { volume: 0.5 });
      if (s.phase === "roundOver" && prev.phase !== "roundOver") ctx.sound(s.outcome === "solved" ? (s.setter === seat ? "lose" : "win") : s.setter === seat ? "win" : "lose");
    }
    prev = { turn: s.turn, phase: s.phase, lastTs: s.last?.ts };
  }

  function msgLine(el, text, bad) { const m = el.querySelector(".msg"); if (m) { m.textContent = text; m.classList.toggle("bad", !!bad); } }

  return {
    mount(c) { ctx = c; },
    unmount() { stopTimer?.(); stopTimer = null; },
    render(view) {
      v = view;
      const el = ctx.el, s = normalizeState(view.state), T = view.theme, sk = skin(T), seat = seatOf();
      const inGame = seat && s.order.includes(seat);
      feedback(s, seat);
      stopTimer?.();
      if (pending && (s.last?.ts >= pending.after || Date.now() - pending.at > 4000 || s.turn !== seat)) pending = null;
      const n = view.priv?.notice;
      const fresh = n && n.ts > noticeSeen ? n : null;
      if (fresh) { noticeSeen = n.ts; pending = null; }
      const myScore = inGame ? `<span class="badge">${esc(nm(s, seat))} · ${s.scores[seat] || 0} pts</span>` : '<div class="badge">👀 Spectating</div>';

      if (s.phase === "setting") {
        if (seat === s.setter) {
          if (el.querySelector(".hm-set")) { if (fresh) msgLine(el, fresh.text, true); return; } // keep typing undisturbed
          el.innerHTML = `<div class="pl hm-set">${myScore}
            <div class="pb-status"><span class="t">You pick the word!</span><span class="timer"></span></div>
            <p class="sub">Everyone else will try to guess it. Up to 4 words, letters only.</p>
            <input class="hm-input" id="hmWord" maxlength="30" autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="characters" placeholder="SECRET WORD" value="${esc(draft)}">
            <div class="ph-actions"><button class="btn" data-act="use">Use this</button><button class="btn ghost" data-act="random">🎲 Random</button></div>
            <p class="msg">${fresh ? esc(fresh.text) : ""}</p></div>`;
          const inp = el.querySelector("#hmWord");
          inp.addEventListener("input", () => { draft = inp.value; });
          const use = () => { const c = cleanWord(inp.value); if (c.error) { msgLine(el, c.error, true); ctx.sound("error"); return; } ctx.send("setWord", { word: c.word }); msgLine(el, "Sending…"); draft = ""; };
          inp.addEventListener("keydown", (e) => { if (e.key === "Enter") use(); });
          el.querySelector('[data-act="use"]').addEventListener("click", use);
          el.querySelector('[data-act="random"]').addEventListener("click", () => { ctx.send("setWord", { random: true }); msgLine(el, "Picking one…"); draft = ""; });
          stopTimer = phoneTimer(el, ctx, () => normalizeState(v.state).timerEndsAt);
          return;
        }
        el.innerHTML = `<div class="pw">${myScore}<h1>${esc(fmt(sk.setter, { name: nm(s, s.setter) }))}</h1>
          <p class="sub">Round ${s.round} of ${s.order.length}</p>${emoteBarHTML(T)}</div>`;
        wireEmotes(el, ctx);
        return;
      }

      if (s.phase === "guessing") {
        const mine = seat && s.turn === seat;
        if (seat === s.setter) {
          el.innerHTML = `<div class="pb">${myScore}
            <div class="pb-status"><span class="t">Your word — watch them squirm</span><span class="timer"></span></div>
            ${wordHTML(view.priv?.word || s.mask, "phone mine")}
            ${wordHTML(s.mask, "phone")}
            <p class="sub">Strikes: ${s.strikes}/${MAX_STRIKES} · ${esc(lastText(s))}</p>${emoteBarHTML(T)}</div>`;
          wireEmotes(el, ctx);
          stopTimer = phoneTimer(el, ctx, () => normalizeState(v.state).timerEndsAt);
          return;
        }
        if (!mine) solving = false;
        el.innerHTML = `<div class="pb ${mine ? "mine" : "theirs"}">${myScore}
          <div class="pb-status"><span class="t">${mine ? "YOUR GUESS!" : esc(`${nm(s, s.turn)} is guessing…`)}</span><span class="timer"></span></div>
          ${wordHTML(s.mask, "phone")}
          <p class="sub">Strikes: ${s.strikes}/${MAX_STRIKES} · ${esc(lastText(s))}</p>
          ${mine && solving ? `<input class="hm-input" id="hmSolve" maxlength="30" autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="characters" placeholder="THE ANSWER">
            <div class="ph-actions"><button class="btn" data-act="solve">Solve!</button><button class="btn ghost" data-act="cancel">Back</button></div>`
            : `${alphaHTML(s, { tap: mine && !pending })}${mine ? '<div class="ph-actions"><button class="btn ghost" data-act="solving">I know it — solve</button></div>' : ""}`}
          <p class="msg">${fresh ? esc(fresh.text) : ""}</p>
          ${mine ? "" : emoteBarHTML(T)}</div>`;
        el.querySelectorAll(".hm-key").forEach((b) => b.addEventListener("click", () => {
          if (b.disabled || pending) return;
          pending = { at: Date.now(), after: s.last?.ts ? s.last.ts + 1 : 0 };
          el.querySelectorAll(".hm-key").forEach((x) => { x.disabled = true; });
          b.classList.add("aim");
          ctx.send("guess", { l: b.dataset.l });
        }));
        el.querySelector('[data-act="solving"]')?.addEventListener("click", () => { solving = true; view && this.render(v); el.querySelector("#hmSolve")?.focus(); });
        el.querySelector('[data-act="cancel"]')?.addEventListener("click", () => { solving = false; this.render(v); });
        el.querySelector('[data-act="solve"]')?.addEventListener("click", () => {
          const t = el.querySelector("#hmSolve").value;
          if (!t.trim()) return;
          solving = false;
          pending = { at: Date.now(), after: s.last?.ts ? s.last.ts + 1 : 0 };
          ctx.send("solve", { text: t });
        });
        el.querySelector("#hmSolve")?.addEventListener("keydown", (e) => { if (e.key === "Enter") el.querySelector('[data-act="solve"]').click(); });
        wireEmotes(el, ctx);
        stopTimer = phoneTimer(el, ctx, () => normalizeState(v.state).timerEndsAt);
        return;
      }

      if (s.phase === "roundOver") {
        const p = inGame ? s.roundPts[seat] || 0 : 0;
        el.innerHTML = `<div class="po ${s.outcome === "solved" ? "won" : "lost"}">
          <h1 class="big">${esc(s.outcome === "solved" ? sk.win : sk.lose)}</h1>
          ${wordHTML(s.mask, "phone reveal")}
          ${inGame ? `<p class="sub">You scored <b>+${p}</b> this round</p>` : ""}
          ${scoresHTML(s, { showRound: true })}
          <p class="sub">${s.round >= s.order.length ? "Final scores coming up…" : "Next round starting…"}</p>${emoteBarHTML(T)}</div>`;
        wireEmotes(el, ctx);
        return;
      }

      if (s.phase === "gameOver") {
        const top = leaders(s);
        const won = inGame && (s.scores[seat] || 0) === (s.scores[top[0]] || 0);
        el.innerHTML = `<div class="po ${won ? "won" : "lost"}">
          <h1 class="big">${won ? "YOU WIN!" : `${esc(nm(s, top[0]))} WINS`}</h1>
          ${scoresHTML(s)}
          ${seat ? '<button class="btn huge" data-act="again">🔁 Play again</button>' : ""}${emoteBarHTML(T)}</div>`;
        el.querySelector('[data-act="again"]')?.addEventListener("click", () => { ctx.send("again"); ctx.sound("ready"); });
        wireEmotes(el, ctx);
      }
    },
  };
}
