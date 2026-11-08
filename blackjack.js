// blackjack.js — Blackjack for 1–6 players against the TV dealer.
// 6-deck shoe, dealer stands on all 17s, blackjack pays 3:2, double on any
// first two cards, one split per hand (split aces get one card each), dealer
// peeks for blackjack. Everyone starts with 1000 chips; going broke gets a
// 500-chip bailout. Cards are "RS" strings: rank A23456789TJQK + suit SHDC.
import { esc, arr, seatList, tvLayers, handleEmote, ringHTML, updateRing, tickSound, overControlsHTML, wireOverControls, emoteBarHTML, wireEmotes, phoneTimer } from "./kit.js";

export const id = "blackjack";
export const SEATS = seatList(6);
export const START_CHIPS = 1000, BAILOUT = 500, MIN_BET = 10, MAX_BET = 500;
export const BET_MS = 25000, TURN_MS = 20000, DEALER_STEP_MS = 900, SETTLE_MS = 7000, DECKS = 6;

const SKIN = {
  classic: { title: "Blackjack", dealer: "Dealer", cur: "$", bust: "BUST", bj: "BLACKJACK!", tagline: "Beat the dealer to 21" },
  shit: { title: "Crapjack", dealer: "The Plumber", cur: "🧻", bust: "CLOGGED", bj: "CRAPJACK!", tagline: "Beat the Plumber to 21" },
};
const skin = (T) => SKIN[T.id] || SKIN.classic;

/* ---------------------------------------------------------------- engine */

export function newShoe(rng = Math.random) {
  const d = [];
  for (let k = 0; k < DECKS; k++) for (const s of "SHDC") for (const r of "A23456789TJQK") d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
export const cardsOf = (str) => (str ? String(str).split(" ").filter(Boolean) : []);
const rankVal = (r) => (r === "A" ? 11 : "TJQK".includes(r) ? 10 : Number(r));
export function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { if (c === "??") continue; total += rankVal(c[0]); if (c[0] === "A") aces++; }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
export const isBlackjack = (cards, split = false) => !split && cards.length === 2 && handValue(cards).total === 21;

export function initialState() {
  return { game: id, phase: "lobby", hand: 0, table: {}, dealer: { cards: "" }, order: [], turn: null, timerEndsAt: null, nextAt: null, dealerBJ: false };
}
function normHand(h) {
  return { cards: h?.cards || "", bet: h?.bet || 0, done: !!h?.done, doubled: !!h?.doubled, split: !!h?.split, result: h?.result || null, net: h?.net || 0 };
}
export function normalizeState(s) {
  const b = initialState();
  if (!s) return b;
  const n = { ...b, ...s, game: id };
  n.table = {};
  for (const [k, p] of Object.entries(s.table || {})) {
    n.table[k] = { name: p.name || k, chips: p.chips ?? START_CHIPS, bet: p.bet || 0, lastBet: p.lastBet || 0, bailouts: p.bailouts || 0, hands: arr(p.hands).map(normHand) };
  }
  n.dealer = { cards: s.dealer?.cards || "" };
  n.order = arr(s.order);
  n.turn = s.turn ? { seat: s.turn.seat, h: s.turn.h || 0 } : null;
  for (const k of ["timerEndsAt", "nextAt"]) n[k] = s[k] ?? null;
  n.dealerBJ = !!s.dealerBJ;
  return n;
}
const clone = (s) => JSON.parse(JSON.stringify(s));
function draw(shoe) { return shoe.length ? shoe.shift() : newShoe().shift(); }

/** Open the betting window. seated: seat -> {name} | null. */
export function startBetting(s, seated, now) {
  const n = clone(s);
  const table = {};
  for (const seat of SEATS) {
    if (!seated[seat]) continue;
    const p = n.table[seat] || { chips: START_CHIPS, bailouts: 0, lastBet: 0 };
    let { chips, bailouts } = p;
    if (chips < MIN_BET) { chips += BAILOUT; bailouts += 1; }
    table[seat] = { name: seated[seat].name, chips, bailouts, bet: 0, lastBet: p.lastBet || 0, hands: [] };
  }
  return { ...n, phase: "betting", hand: n.hand + 1, table, dealer: { cards: "" }, order: [], turn: null, dealerBJ: false, timerEndsAt: now + BET_MS, nextAt: null };
}
/** Seat a newcomer mid-hand (they play from the next hand). */
export function syncSeats(s, seated) {
  const n = clone(s);
  let changed = false;
  for (const seat of SEATS) {
    const who = seated[seat];
    if (who && !n.table[seat]) { n.table[seat] = { name: who.name, chips: START_CHIPS, bailouts: 0, bet: 0, lastBet: 0, hands: [] }; changed = true; }
    else if (who && n.table[seat].name !== who.name) { n.table[seat].name = who.name; changed = true; }
    else if (!who && n.table[seat] && !n.order.includes(seat)) { delete n.table[seat]; changed = true; }
  }
  return changed ? n : null;
}
export function placeBet(s, seat, amount) {
  if (s.phase !== "betting") return { error: "Betting is closed" };
  const p = s.table[seat];
  if (!p) return { error: "You're not at the table" };
  const a = Math.floor(Number(amount));
  if (!Number.isFinite(a) || a < MIN_BET) return { error: `Minimum bet is ${MIN_BET}` };
  if (a > MAX_BET) return { error: `Maximum bet is ${MAX_BET}` };
  if (a > p.chips) return { error: "Not enough chips" };
  const n = clone(s);
  n.table[seat].bet = a;
  n.table[seat].lastBet = a;
  return { state: n };
}
export const everyoneBet = (s, isActive = () => true) => {
  const seats = Object.keys(s.table).filter(isActive);
  return seats.length > 0 && seats.every((k) => s.table[k].bet > 0);
};

/** Deal a hand. Mutates nothing; returns {state, shoe, hole} or {state} if nobody bet. */
export function deal(s, shoe, now, rng = Math.random) {
  const n = clone(s);
  const order = SEATS.filter((k) => n.table[k]?.bet > 0);
  if (!order.length) return { state: { ...n, timerEndsAt: now + BET_MS }, shoe, idle: true };
  const reshuffled = !(shoe && shoe.length >= 80);
  const sh = reshuffled ? newShoe(rng) : [...shoe];
  for (const k of order) {
    const p = n.table[k];
    p.chips -= p.bet;
    p.hands = [{ cards: "", bet: p.bet, done: false, doubled: false, split: false, result: null, net: 0 }];
  }
  const dealer = [];
  for (let round = 0; round < 2; round++) {
    for (const k of order) n.table[k].hands[0].cards = [...cardsOf(n.table[k].hands[0].cards), draw(sh)].join(" ");
    dealer.push(draw(sh));
  }
  const [up, hole] = dealer;
  for (const k of order) { const h = n.table[k].hands[0]; if (isBlackjack(cardsOf(h.cards))) h.done = true; }
  n.order = order;
  n.dealer = { cards: `${up} ??` };
  const peek = up[0] === "A" || "TJQK".includes(up[0]);
  if (peek && isBlackjack([up, hole])) {
    n.dealer = { cards: `${up} ${hole}` };
    n.dealerBJ = true;
    return { state: settle(n, now), shoe: sh, hole: null, reshuffled };
  }
  return { state: advance(n, now), shoe: sh, hole, reshuffled };
}
/** Move the turn to the next unfinished hand, or hand over to the dealer. */
export function advance(s, now) {
  for (const k of s.order) {
    const hs = s.table[k].hands;
    for (let h = 0; h < hs.length; h++) if (!hs[h].done) return { ...s, phase: "playing", turn: { seat: k, h }, timerEndsAt: now + TURN_MS };
  }
  return { ...s, phase: "dealer", turn: null, timerEndsAt: null, nextAt: now + DEALER_STEP_MS };
}
export function canDouble(s, seat) {
  const t = s.turn;
  if (!t || t.seat !== seat) return false;
  const p = s.table[seat], h = p.hands[t.h];
  return cardsOf(h.cards).length === 2 && p.chips >= h.bet;
}
export function canSplit(s, seat) {
  const t = s.turn;
  if (!t || t.seat !== seat) return false;
  const p = s.table[seat], h = p.hands[t.h], c = cardsOf(h.cards);
  return p.hands.length === 1 && c.length === 2 && rankVal(c[0][0]) === rankVal(c[1][0]) && p.chips >= h.bet;
}
/** A player action: hit | stand | double | split. */
export function act(s, shoe, seat, action, now) {
  if (s.phase !== "playing" || !s.turn) return { error: "Not your turn" };
  if (s.turn.seat !== seat) return { error: "Not your turn" };
  const n = clone(s), sh = [...shoe];
  const p = n.table[seat], hi = n.turn.h, h = p.hands[hi];
  const finish = () => {
    const v = handValue(cardsOf(h.cards)).total;
    if (v >= 21) h.done = true;
  };
  if (action === "hit") { h.cards = [...cardsOf(h.cards), draw(sh)].join(" "); finish(); }
  else if (action === "stand") h.done = true;
  else if (action === "double") {
    if (!canDouble(s, seat)) return { error: "Can't double now" };
    p.chips -= h.bet; h.bet *= 2; h.doubled = true;
    h.cards = [...cardsOf(h.cards), draw(sh)].join(" ");
    h.done = true;
  } else if (action === "split") {
    if (!canSplit(s, seat)) return { error: "Can't split this hand" };
    const [a, b] = cardsOf(h.cards);
    p.chips -= h.bet;
    const aces = a[0] === "A";
    const h1 = { ...h, cards: `${a} ${draw(sh)}`, split: true, done: aces };
    const h2 = { ...h, cards: `${b} ${draw(sh)}`, split: true, done: aces };
    for (const x of [h1, h2]) if (handValue(cardsOf(x.cards)).total === 21) x.done = true;
    p.hands = [h1, h2];
  } else return { error: "Unknown action" };
  const st = n.table[seat].hands[n.turn.h].done || action === "split" ? advance(n, now) : { ...n, timerEndsAt: now + TURN_MS };
  return { state: st, shoe: sh, event: { seat, action } };
}

/** One dealer step: reveal the hole card, draw, or settle. */
export function dealerStep(s, shoe, hole, now) {
  const n = clone(s), sh = [...shoe];
  let cards = cardsOf(n.dealer.cards);
  if (cards.includes("??")) {
    cards = cards.map((c) => (c === "??" ? hole : c));
    n.dealer.cards = cards.join(" ");
    return { state: { ...n, nextAt: now + DEALER_STEP_MS }, shoe: sh, event: "reveal" };
  }
  const live = n.order.some((k) => n.table[k].hands.some((h) => handValue(cardsOf(h.cards)).total <= 21 && !isBlackjack(cardsOf(h.cards), h.split)));
  if (live && handValue(cards).total < 17) {
    n.dealer.cards = [...cards, draw(sh)].join(" ");
    return { state: { ...n, nextAt: now + DEALER_STEP_MS }, shoe: sh, event: "draw" };
  }
  return { state: settle(n, now), shoe: sh, event: "settle" };
}
export function settle(s, now) {
  const n = clone(s);
  const dc = cardsOf(n.dealer.cards);
  const dv = handValue(dc).total, dBJ = isBlackjack(dc);
  for (const k of n.order) {
    const p = n.table[k];
    for (const h of p.hands) {
      const c = cardsOf(h.cards), v = handValue(c).total, bj = isBlackjack(c, h.split);
      let ret = 0, result;
      if (v > 21) result = "bust";
      else if (bj && !dBJ) { result = "blackjack"; ret = h.bet + Math.floor(h.bet * 1.5); }
      else if (dBJ && !bj) result = "lose";
      else if (bj && dBJ) { result = "push"; ret = h.bet; }
      else if (dv > 21 || v > dv) { result = "win"; ret = h.bet * 2; }
      else if (v === dv) { result = "push"; ret = h.bet; }
      else result = "lose";
      h.result = result;
      h.net = ret - h.bet;
      h.done = true;
      p.chips += ret;
    }
  }
  return { ...n, phase: "settle", turn: null, dealerBJ: dBJ, timerEndsAt: null, nextAt: now + SETTLE_MS };
}

/* -------------------------------------------------------------- render */

const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };
// Each card animates in once: remember which (hand, spot, index, card) we've drawn.
const seenCards = new Set();
let seenHand = null;
function cardHTML(c, i, isNew) {
  const anim = isNew ? ` deal" style="--i:${i}` : "";
  if (c === "??") return `<span class="pc back${anim}"></span>`;
  const r = c[0] === "T" ? "10" : c[0], s = c[1];
  return `<span class="pc ${s === "H" || s === "D" ? "red" : ""}${anim}"><b>${r}<small>${SUIT[s]}</small></b><i>${SUIT[s]}</i></span>`;
}
function cardsHTML(str, where = "", hand = 0) {
  if (hand !== seenHand) { seenCards.clear(); seenHand = hand; }
  let n = 0;
  return `<div class="pcs">${cardsOf(str).map((c, i) => {
    const key = `${where}|${i}|${c}`;
    const isNew = !seenCards.has(key);
    seenCards.add(key);
    return cardHTML(c, isNew ? n++ : 0, isNew);
  }).join("")}</div>`;
}
const totalOf = (str) => { const c = cardsOf(str); if (!c.length) return ""; const { total, soft } = handValue(c); return soft && total < 21 && !c.includes("??") ? `${total - 10}/${total}` : String(total); };
const RESULT = (T) => ({ win: "WIN", lose: "LOSE", push: "PUSH", bust: skin(T).bust, blackjack: skin(T).bj });
const money = (T, n) => `${skin(T).cur}${n}`;

function seatHTML(s, k, T, { active = false } = {}) {
  const p = s.table[k];
  const handsHtml = p.hands.length ? p.hands.map((h, i) => {
    const on = active && s.turn?.seat === k && s.turn.h === i;
    return `<div class="bj-hand ${on ? "on" : ""} ${h.result || ""}">${cardsHTML(h.cards, `${k}-${i}`, s.hand)}
      <div class="bj-meta"><span class="tot">${totalOf(h.cards)}</span><span class="bet">${money(T, h.bet)}${h.doubled ? " ×2" : ""}</span></div>
      ${h.result ? `<div class="bj-res ${h.result}">${esc(RESULT(T)[h.result])}${h.net ? ` ${h.net > 0 ? "+" : "−"}${Math.abs(h.net)}` : ""}</div>` : ""}</div>`;
  }).join("") : s.phase === "betting" ? `<div class="bj-betting ${p.bet ? "in" : ""}">${p.bet ? `Bet ${money(T, p.bet)} ✅` : '<span class="dots">Betting</span>'}</div>` : '<div class="bj-betting">Sitting out</div>';
  return `<div class="bj-seat panel ${s.turn?.seat === k ? "turn" : ""}"><div class="bj-name">${esc(p.name)}</div>
    <div class="bj-chips">${money(T, p.chips)}${p.bailouts ? ` <small>· bailed out ×${p.bailouts}</small>` : ""}</div>${handsHtml}</div>`;
}

/* ------------------------------------------------------------------- TV */

export function createHost() {
  let room = null, L = null;
  const lastEmoteAt = {}, tickMemo = {};
  const S = () => normalizeState(room.state);
  const shoe = () => cardsOf(room.secret?.shoe);
  const saveSecret = (sh, hole) => room.setSecret({ shoe: sh.join(" "), hole: hole ?? room.secret?.hole ?? null });
  const seatedNow = () => room.seatInfo();
  const online = (k) => { const u = room.uidForSeat(k); return !!u && room.isOnline(u); };

  function doDeal(s) {
    const t = room.now();
    const res = deal(s, shoe(), t);
    if (res.idle) { room.setState(res.state); return; }
    saveSecret(res.shoe, res.hole);
    room.setState(res.state);
    room.sound("place");
    if (res.reshuffled) L.flash("Shuffling…", "miss");
    if (res.state.phase === "settle") { L.flash(`${skin(room.theme).dealer}: ${skin(room.theme).bj}`, "sunk"); room.sound("lose"); }
  }

  const mod = {
    id,
    init(r) { room = r; L = tvLayers(r.el); },
    canStart() { return Object.values(room.seatInfo()).some(Boolean); },
    startHint() { return "Blackjack needs at least 1 player"; },
    start() {
      if (!mod.canStart()) return;
      room.setState(startBetting(S(), seatedNow(), room.now()));
      room.sound("ready");
    },
    onPlayersChanged() {
      if (!room.state) return;
      const s = S();
      if (s.phase === "lobby") return;
      const n = syncSeats(s, seatedNow());
      if (n) room.setState(n);
    },
    onSeatTransfer() {},
    onAction(uid, a) {
      if (handleEmote(room, L, lastEmoteAt, uid, a)) return;
      const seat = room.seatOf(uid);
      if (!seat) return;
      const s = S(), t = room.now();
      const notice = (text) => room.setPrivate(uid, "notice", { text, ts: t });
      if (a.type === "bet") {
        const res = placeBet(s, seat, a.payload?.amount);
        if (res.error) return notice(res.error);
        room.setState(res.state);
        room.sound("place");
        if (everyoneBet(res.state, online)) doDeal(res.state);
        return;
      }
      if (["hit", "stand", "double", "split"].includes(a.type)) {
        const res = act(s, shoe(), seat, a.type, t);
        if (res.error) return notice(res.error);
        saveSecret(res.shoe);
        room.setState(res.state);
        const h = res.state.table[seat].hands;
        const busted = h.some((x) => x.done && handValue(cardsOf(x.cards)).total > 21) && a.type !== "stand";
        room.sound(busted ? "miss" : a.type === "stand" ? "ready" : "place");
        if (busted) L.flash(skin(room.theme).bust, "miss");
      }
    },
    tick(t) {
      if (!room?.state) return;
      const s = S();
      if (s.phase === "betting") {
        if (s.timerEndsAt && t >= s.timerEndsAt) { doDeal(s); return; }
      } else if (s.phase === "playing" && s.turn) {
        const off = !online(s.turn.seat) && t > s.timerEndsAt - TURN_MS + 3000;
        if ((s.timerEndsAt && t >= s.timerEndsAt) || off) {
          const res = act(s, shoe(), s.turn.seat, "stand", t);
          if (!res.error) { room.setState(res.state); room.sound("ready"); }
          return;
        }
      } else if (s.phase === "dealer") {
        if (s.nextAt && t >= s.nextAt) {
          const res = dealerStep(s, shoe(), room.secret?.hole, t);
          saveSecret(res.shoe);
          room.setState(res.state);
          if (res.event === "settle") {
            const any = res.state.order.flatMap((k) => res.state.table[k].hands);
            const dv = handValue(cardsOf(res.state.dealer.cards)).total;
            if (dv > 21) L.flash(`${skin(room.theme).dealer} ${skin(room.theme).bust}!`, "hit");
            room.sound(any.some((h) => h.net > 0) ? "win" : "lose");
          } else room.sound("place");
        }
        return;
      } else if (s.phase === "settle") {
        if (s.nextAt && t >= s.nextAt) { room.setState(startBetting(s, seatedNow(), t)); room.sound("turn"); }
        return;
      }
      tickSound(room, s.timerEndsAt, t, tickMemo);
      updateRing(L.screen, s.timerEndsAt, s.phase === "betting" ? BET_MS : TURN_MS, t);
    },
    render(state) {
      if (!L) return;
      const s = normalizeState(state), T = room.theme, sk = skin(T);
      if (s.phase === "lobby") return;
      const seats = SEATS.filter((k) => s.table[k]);
      let banner = "";
      if (s.phase === "betting") banner = "Place your bets!";
      else if (s.phase === "playing") banner = `${s.table[s.turn.seat]?.name || ""}'s turn`;
      else if (s.phase === "dealer") banner = `${sk.dealer} plays`;
      else if (s.phase === "settle") banner = s.dealerBJ ? `${sk.dealer} has ${sk.bj}` : "Results";
      const dc = s.dealer.cards;
      const prevKey = document.activeElement?.dataset?.key;
      L.screen.innerHTML = `<div class="bj-tv">
        <header class="bs-top"><div class="bs-title sm">${esc(sk.title)}</div><div class="bs-banner">${esc(banner)}</div>${ringHTML()}</header>
        <div class="bj-dealer"><div class="bj-dname">${esc(sk.dealer)}${dc ? ` · <b>${totalOf(dc)}</b>` : ""}</div>${dc ? cardsHTML(dc, "d", s.hand) : `<p class="hint">${esc(sk.tagline)} · bets ${money(T, MIN_BET)}–${money(T, MAX_BET)} · blackjack pays 3:2</p>`}</div>
        <div class="bj-seats n${seats.length}">${seats.map((k) => seatHTML(s, k, T, { active: true })).join("")}</div>
        ${s.phase === "betting" ? overControlsHTML(T) : ""}</div>`;
      if (s.phase === "betting") wireOverControls(L.screen, room);
      void prevKey;
      updateRing(L.screen, s.phase === "betting" || s.phase === "playing" ? s.timerEndsAt : null, s.phase === "betting" ? BET_MS : TURN_MS, room.now());
    },
  };
  return mod;
}

/* ---------------------------------------------------------------- phone */

export function createPhone() {
  let ctx = null, v = null, prev = null, stopTimer = null, draft = null, pending = null, noticeSeen = 0, editing = false;
  const seatOf = () => (/^p\d$/.test(v?.me?.role || "") ? v.me.role : null);

  function feedback(s, seat) {
    if (prev && seat) {
      const myTurn = s.phase === "playing" && s.turn?.seat === seat;
      if (myTurn && !prev.myTurn) { ctx.sound("turn"); ctx.vibrate(60); }
      if (s.phase === "settle" && prev.phase !== "settle" && s.table[seat]?.hands?.length) {
        const net = s.table[seat].hands.reduce((a, h) => a + h.net, 0);
        setTimeout(() => ctx.sound(net > 0 ? "win" : net < 0 ? "lose" : "ready"), 300);
        if (net > 0) ctx.vibrate([60, 40, 60]);
      }
      if (s.phase === "betting" && prev.phase !== "betting") { editing = false; ctx.vibrate(40); }
    }
    prev = { phase: s.phase, myTurn: s.phase === "playing" && s.turn?.seat === seat };
  }

  return {
    mount(c) { ctx = c; },
    unmount() { stopTimer?.(); stopTimer = null; },
    render(view) {
      v = view;
      const el = ctx.el, s = normalizeState(view.state), T = view.theme, sk = skin(T), seat = seatOf();
      const p = seat ? s.table[seat] : null;
      feedback(s, seat);
      stopTimer?.();
      const n = view.priv?.notice;
      const fresh = n && n.ts > noticeSeen ? n : null;
      if (fresh) { noticeSeen = n.ts; pending = null; }
      const sig = JSON.stringify([s.turn, p?.hands, s.phase]);
      if (pending && (Date.now() - pending.at > 4000 || sig !== pending.sig)) pending = null;
      const head = p ? `<div class="bj-me"><b>${esc(p.name)}</b><span>${money(T, p.chips)}</span></div>` : '<div class="badge">👀 Spectating</div>';
      const dealerRow = s.dealer.cards ? `<div class="bj-pdealer"><span>${esc(sk.dealer)} <b>${totalOf(s.dealer.cards)}</b></span>${cardsHTML(s.dealer.cards, "d", s.hand)}</div>` : "";

      if (!p) {
        el.innerHTML = `<div class="sp">${head}<div class="pb-status"><span class="t">${esc(s.phase === "betting" ? "Players are betting…" : s.phase === "playing" ? `${s.table[s.turn.seat]?.name}'s turn` : sk.title)}</span></div>
          ${dealerRow}<p class="sub">${seat ? "" : "All seats are full, or you joined as a spectator. The host can seat you with Swap."}</p>${emoteBarHTML(T)}</div>`;
        wireEmotes(el, ctx);
        return;
      }

      if (s.phase === "betting") {
        if (draft == null) draft = Math.min(p.lastBet || 50, p.chips);
        draft = Math.max(0, Math.min(draft, p.chips, MAX_BET));
        const locked = p.bet > 0 && !editing;
        el.innerHTML = `<div class="pl bj-bet">${head}
          <div class="pb-status"><span class="t">${locked ? "Bet placed — waiting for others" : "Place your bet"}</span><span class="timer"></span></div>
          <div class="bj-amount">${money(T, locked ? p.bet : draft)}</div>
          ${locked ? '<div class="ph-actions"><button class="btn ghost" data-act="edit">Change bet</button></div>' : `
          <div class="bj-chipsrow">${[10, 25, 100, 500].map((c) => `<button class="bj-chip c${c}" data-add="${c}" ${draft + c > Math.min(p.chips, MAX_BET) ? "disabled" : ""}>+${c}</button>`).join("")}</div>
          <div class="ph-actions"><button class="btn ghost" data-act="clear">Clear</button><button class="btn ghost" data-act="max">Max</button></div>
          <div class="ph-actions"><button class="btn huge" data-act="bet" ${draft < MIN_BET ? "disabled" : ""}>Bet ${money(T, draft)}</button></div>`}
          <p class="msg ${fresh ? "bad" : ""}">${fresh ? esc(fresh.text) : `Bets ${money(T, MIN_BET)}–${money(T, MAX_BET)}`}</p>${emoteBarHTML(T)}</div>`;
        el.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => { draft += +b.dataset.add; ctx.sound("place"); this.render(v); }));
        el.querySelector('[data-act="clear"]')?.addEventListener("click", () => { draft = 0; this.render(v); });
        el.querySelector('[data-act="max"]')?.addEventListener("click", () => { draft = Math.min(p.chips, MAX_BET); this.render(v); });
        el.querySelector('[data-act="edit"]')?.addEventListener("click", () => { editing = true; draft = p.bet; this.render(v); });
        el.querySelector('[data-act="bet"]')?.addEventListener("click", () => { editing = false; ctx.send("bet", { amount: draft }); ctx.sound("ready"); });
        wireEmotes(el, ctx);
        stopTimer = phoneTimer(el, ctx, () => normalizeState(v.state).timerEndsAt);
        return;
      }

      draft = null;
      const myTurn = s.phase === "playing" && s.turn?.seat === seat;
      const hands = p.hands.length ? p.hands.map((h, i) => `<div class="bj-hand big ${myTurn && s.turn.h === i ? "on" : ""} ${h.result || ""}">${cardsHTML(h.cards, `${seat}-${i}`, s.hand)}
          <div class="bj-meta"><span class="tot">${totalOf(h.cards)}</span><span class="bet">${money(T, h.bet)}${h.doubled ? " ×2" : ""}</span></div>
          ${h.result ? `<div class="bj-res ${h.result}">${esc(RESULT(T)[h.result])}${h.net ? ` ${h.net > 0 ? "+" : "−"}${Math.abs(h.net)}` : ""}</div>` : ""}</div>`).join("")
        : '<p class="sub">You sat this hand out. Bet on the next one!</p>';
      let status = "";
      if (s.phase === "playing") status = myTurn ? "YOUR MOVE" : `${s.table[s.turn.seat]?.name}'s turn`;
      else if (s.phase === "dealer") status = `${sk.dealer} is playing…`;
      else if (s.phase === "settle") {
        const net = p.hands.reduce((a, h) => a + h.net, 0);
        status = !p.hands.length ? "Next hand soon" : net > 0 ? `You won ${money(T, net)}!` : net < 0 ? `You lost ${money(T, -net)}` : "Push — money back";
      }
      const acts = myTurn && !pending ? `<div class="bj-acts">
          <button class="btn" data-a="hit">Hit</button><button class="btn" data-a="stand">Stand</button>
          ${canDouble(s, seat) ? '<button class="btn ghost" data-a="double">Double</button>' : ""}
          ${canSplit(s, seat) ? '<button class="btn ghost" data-a="split">Split</button>' : ""}</div>` : "";
      el.innerHTML = `<div class="pb bj-play ${myTurn ? "mine" : "theirs"}">${head}
        <div class="pb-status"><span class="t">${esc(status)}</span><span class="timer"></span></div>
        ${dealerRow}<div class="bj-hands">${hands}</div>${acts}
        <p class="msg ${fresh ? "bad" : ""}">${fresh ? esc(fresh.text) : ""}</p>${myTurn ? "" : emoteBarHTML(T)}</div>`;
      el.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => {
        if (pending) return;
        pending = { at: Date.now(), sig };
        el.querySelectorAll("[data-a]").forEach((x) => { x.disabled = true; });
        ctx.sound("place");
        ctx.send(b.dataset.a);
      }));
      wireEmotes(el, ctx);
      if (s.phase === "playing") stopTimer = phoneTimer(el, ctx, () => { const st = normalizeState(v.state); return st.turn?.seat === seat ? st.timerEndsAt : null; });
    },
  };
}
