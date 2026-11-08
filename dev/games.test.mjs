// node dev/games.test.mjs — rules tests + random simulations for Connect 4,
// Hangman and Blackjack. Pure engine code only (no Firebase, no DOM).
import * as C4 from "../connect4.js";
import * as HM from "../hangman.js";
import * as BJ from "../blackjack.js";

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.error("FAIL:", msg); } };
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(42);
const seated = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i + 1}`, { name: `Bot${i + 1}` }]));

/* ------------------------------------------------------------ Connect 4 */
{
  let s = C4.startRound({ ...C4.initialState(), seats: seated(2) }, 0);
  ok(s.turn === "p1" && s.phase === "play", "c4: p1 starts round 1");
  // vertical win for p1 in column 0
  for (let i = 0; i < 3; i++) { s = C4.move(s, "p1", 0, 1).state; s = C4.move(s, "p2", 1, 1).state; }
  const w = C4.move(s, "p1", 0, 1);
  ok(w.state.phase === "gameOver" && w.state.winner === "p1" && w.state.winLine.length === 4, "c4: vertical win");
  ok(C4.move(s, "p2", 0, 1).error, "c4: out of turn rejected");
  // full column
  let f = C4.startRound(C4.initialState(), 0);
  let seat = "p1";
  for (let i = 0; i < 6; i++) { f = C4.move(f, seat, 3, 1).state; seat = seat === "p1" ? "p2" : "p1"; }
  ok(C4.move(f, seat, 3, 1).error === "That column is full", "c4: full column rejected");
  // diagonal
  const d = "......." + "......." + "...1..." + "..12..." + ".122..." + "1222...";
  ok(C4.findLine(d, 2 * 7 + 3).length === 4, "c4: diagonal detected");
  ok(C4.findLine(d, 5 * 7 + 1).length === 0 || d[5 * 7 + 1] !== "1", "c4: non-line not detected");
  // rematch alternates starter
  const r = C4.requestRematch(C4.requestRematch(w.state, "p1", 5).state, "p2", 5);
  ok(r.restarted && r.state.turn === "p2" && r.state.round === 2, "c4: rematch, p2 starts round 2");
  // simulation
  const brute = (b) => { for (let i = 0; i < 42; i++) if (b[i] !== "." && C4.findLine(b, i).length) return true; return false; };
  let wins = 0, draws = 0;
  for (let g = 0; g < 400; g++) {
    let st = C4.startRound({ ...C4.initialState(), round: g }, 0);
    let moves = 0;
    while (st.phase === "play") {
      const res = rng() < 0.1 ? C4.timeoutMove(st, moves, rng) : (() => { const cols = C4.openCols(st.board); return C4.move(st, st.turn, cols[Math.floor(rng() * cols.length)], moves); })();
      if (res.error) { ok(false, "c4 sim: legal move errored " + res.error); break; }
      const before = st;
      st = res.state;
      moves++;
      ok([...st.board].filter((c) => c !== ".").length === moves, "c4 sim: one disc per move");
      if (st.phase === "play") ok(!brute(st.board) && st.turn !== before.turn, "c4 sim: no unnoticed win, turn alternates");
    }
    if (st.winner === "draw") { draws++; ok(!st.board.includes(".") && !brute(st.board), "c4 sim: draw is full with no line"); }
    else { wins++; ok(st.winLine.every((i) => st.board[i] === (st.winner === "p1" ? "1" : "2")), "c4 sim: win line belongs to winner"); }
  }
  console.log(`connect4: 400 games (${wins} wins, ${draws} draws)`);
}

/* --------------------------------------------------------------- Hangman */
{
  ok(HM.cleanWord("  hot   dog!! ").word === "HOT DOG", "hm: cleanWord");
  ok(HM.cleanWord("ab").error, "hm: too short rejected");
  ok(HM.cleanWord("a b c d e f").error, "hm: too many words rejected");
  ok(HM.maskOf("HOT DOG", "O") === "_O_ _O_", "hm: mask");
  let s = HM.startGame(HM.initialState(), seated(3), 0);
  ok(s.phase === "setting" && s.setter === "p1" && s.order.length === 3, "hm: p1 sets first");
  ok(HM.setWord(s, "p2", "PIZZA", 1).error, "hm: non-setter can't set");
  let r = HM.setWord(s, "p1", "pizza", 1);
  s = r.state; const word = r.word;
  ok(s.turn === "p2" && s.mask === "_____", "hm: p2 guesses first");
  r = HM.guessLetter(s, word, "p2", "z", 2);
  ok(r.state.turn === "p2" && r.state.roundPts.p2 === 2, "hm: correct letter keeps turn, +1 per letter");
  s = r.state;
  ok(HM.guessLetter(s, word, "p2", "Z", 3).error, "hm: repeat letter rejected");
  r = HM.guessLetter(s, word, "p2", "Q", 3);
  ok(r.state.turn === "p3" && r.state.strikes === 1 && r.state.roundPts.p1 === 1, "hm: wrong letter passes turn, setter +1");
  s = r.state;
  r = HM.solve(s, word, "p3", "piz za", 4);
  ok(r.state.phase === "roundOver" && r.state.outcome === "solved" && r.state.scores.p3 === 6, "hm: solve scores 2 per hidden letter");
  // full simulation
  let games = 0;
  for (let g = 0; g < 200; g++) {
    const n = 2 + Math.floor(rng() * 7);
    let st = HM.startGame(HM.initialState(), seated(n), 0), t = 0, setters = [];
    while (st.phase !== "gameOver") {
      t += 10;
      if (st.phase === "setting") {
        setters.push(st.setter);
        const res = HM.setWord(st, st.setter, HM.randomWord(rng() < 0.5 ? "shit" : "classic", rng), t);
        st = res.state; st._w = res.word;
      } else if (st.phase === "guessing") {
        const w = st._w;
        const x = rng();
        let res;
        if (x < 0.05) res = HM.passTurn(st, t);
        else if (x < 0.1) res = HM.solve(st, w, st.turn, rng() < 0.5 ? w : "NOPE", t);
        else { const left = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].filter((c) => !st.guessed.includes(c) && !st.wrong.includes(c)); res = HM.guessLetter(st, w, st.turn, left[Math.floor(rng() * left.length)], t); }
        if (res.error) { ok(false, "hm sim: " + res.error); break; }
        const prev = st;
        st = { ...res.state, _w: w };
        ok(st.strikes <= HM.MAX_STRIKES, "hm sim: strikes capped");
        if (st.phase === "guessing") { ok(st.turn !== st.setter, "hm sim: setter never guesses"); ok(st.mask === HM.maskOf(w, st.guessed), "hm sim: mask consistent"); }
        if (st.phase === "roundOver") ok(st.mask === w && (st.outcome === "hanged") === (st.strikes >= HM.MAX_STRIKES), "hm sim: round end consistent");
        void prev;
      } else if (st.phase === "roundOver") st = { ...HM.nextRound(st, t).state };
    }
    ok(setters.length === n && new Set(setters).size === n, "hm sim: everyone sets exactly once");
    games++;
  }
  console.log(`hangman: ${games} games`);
}

/* ------------------------------------------------------------- Blackjack */
{
  ok(BJ.handValue(["AS", "KD"]).total === 21 && BJ.isBlackjack(["AS", "KD"]), "bj: blackjack");
  ok(BJ.handValue(["AS", "AD", "9C"]).total === 21, "bj: soft aces");
  ok(BJ.handValue(["KS", "QD", "5C"]).total === 25, "bj: bust total");
  ok(!BJ.isBlackjack(["AS", "KD"], true), "bj: split 21 isn't blackjack");
  // settle payouts
  const mk = (cards, bet = 100, split = false) => ({ cards, bet, done: true, doubled: false, split, result: null, net: 0 });
  const base = { ...BJ.initialState(), phase: "dealer", order: ["p1"], table: { p1: { name: "A", chips: 0, bet: 100, lastBet: 100, bailouts: 0, hands: [] } } };
  const pay = (player, dealer) => { const s = BJ.settle({ ...base, dealer: { cards: dealer }, table: { p1: { ...base.table.p1, hands: [mk(player)] } } }, 0); return s.table.p1.chips; };
  ok(pay("AS KD", "TS 9D") === 250, "bj: blackjack pays 3:2");
  ok(pay("TS 9D", "TS 8D") === 200, "bj: win pays 1:1");
  ok(pay("TS 8D", "TS 8C") === 100, "bj: push returns bet");
  ok(pay("TS 8D 5C", "TS 6C 9H") === 0, "bj: player bust loses even if dealer busts");
  ok(pay("TS 8D", "TS 6C 9H") === 200, "bj: dealer bust pays");
  ok(pay("AS KD", "AH QC") === 100, "bj: blackjack vs blackjack pushes");
  // simulation with chip conservation
  let hands = 0;
  let s = BJ.startBetting(BJ.initialState(), seated(4), 0), shoe = null, hole = null, t = 0, bailIn = 0;
  const total = (st) => Object.values(st.table).reduce((a, p) => a + p.chips + p.hands.reduce((b, h) => b + (h.result ? 0 : h.bet), 0), 0);
  let houseNet = 0;
  for (let i = 0; i < 1500; i++) {
    t += 1000;
    if (s.phase === "betting") {
      for (const k of Object.keys(s.table)) if (rng() < 0.9) { const p = s.table[k]; const a = Math.max(BJ.MIN_BET, Math.min(p.chips, BJ.MAX_BET, 10 * (1 + Math.floor(rng() * 20)))); const r = BJ.placeBet(s, k, a); if (!r.error) s = r.state; }
      const before = total(s);
      const r = BJ.deal(s, shoe, t, rng);
      if (r.idle) { const b0 = Object.values(r.state.table).reduce((a, p) => a + p.chips, 0); s = BJ.startBetting(r.state, seated(4), t); bailIn += Object.values(s.table).reduce((a, p) => a + p.chips, 0) - b0; continue; }
      s = r.state; shoe = r.shoe; hole = r.hole;
      ok(total(s) === before || s.phase === "settle", "bj sim: deal conserves chips");
      ok(BJ.cardsOf(s.dealer.cards).length === 2, "bj sim: dealer has 2 cards");
    } else if (s.phase === "playing") {
      const k = s.turn.seat;
      const choices = ["hit", "stand", "stand"];
      if (BJ.canDouble(s, k)) choices.push("double");
      if (BJ.canSplit(s, k)) choices.push("split", "split");
      const r = BJ.act(s, shoe, k, choices[Math.floor(rng() * choices.length)], t);
      if (r.error) { ok(false, "bj sim: " + r.error); break; }
      s = r.state; shoe = r.shoe;
      for (const p of Object.values(s.table)) for (const h of p.hands) if (!h.done) ok(BJ.handValue(BJ.cardsOf(h.cards)).total < 21, "bj sim: open hands are under 21");
      ok(Object.values(s.table).every((p) => p.chips >= 0), "bj sim: chips never negative");
    } else if (s.phase === "dealer") {
      const r = BJ.dealerStep(s, shoe, hole, t);
      s = r.state; shoe = r.shoe;
    } else if (s.phase === "settle") {
      hands++;
      const dv = BJ.handValue(BJ.cardsOf(s.dealer.cards)).total;
      const anyLive = s.order.some((k) => s.table[k].hands.some((h) => h.result !== "bust" && h.result !== "blackjack"));
      ok(!anyLive || s.dealerBJ || dv >= 17, "bj sim: dealer draws to 17");
      ok(!s.dealer.cards.includes("??"), "bj sim: hole revealed at settle");
      for (const k of s.order) for (const h of s.table[k].hands) { houseNet -= h.net; ok(["win", "lose", "push", "bust", "blackjack"].includes(h.result), "bj sim: every hand settled"); }
      const before = Object.values(s.table).reduce((a, p) => a + p.chips, 0);
      s = BJ.startBetting(s, seated(4), t);
      bailIn += Object.values(s.table).reduce((a, p) => a + p.chips, 0) - before;
    }
  }
  if (s.phase === "settle") for (const k of s.order) for (const h of s.table[k].hands) houseNet -= h.net;
  const final = Object.values(s.table).reduce((a, p) => a + p.chips + p.hands.reduce((b, h) => b + (h.result ? 0 : h.bet), 0), 0);
  ok(final === 4 * BJ.START_CHIPS + bailIn - houseNet, `bj sim: chips conserved (${final} vs ${4 * BJ.START_CHIPS + bailIn - houseNet})`);
  console.log(`blackjack: ${hands} hands, house net ${houseNet}, bailouts paid ${bailIn}`);
}

console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nALL ${checks} CHECKS PASSED`);
process.exit(fails ? 1 : 0);
