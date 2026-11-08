// node dev/games.test.mjs — rules tests + random simulations for Connect 4,
// Hangman, Trivia, Scribble and Blackjack. Pure engine code only (no Firebase, no DOM).
import * as C4 from "../connect4.js";
import * as HM from "../hangman.js";
import * as BJ from "../blackjack.js";
import * as TQ from "../trivia.js";
import * as SC from "../scribble.js";

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


/* ---------------------------------------------------------------- Trivia */
{
  for (const b of TQ.BANK) {
    const [q, c, ...w] = b;
    ok(w.length === 3 || (w.length === 1 && ["True", "False"].includes(c) && ["True", "False"].includes(w[0]) && c !== w[0]), "tq bank shape: " + q);
    ok(new Set([c, ...w]).size === w.length + 1, "tq bank unique answers: " + q);
  }
  ok(new Set(TQ.BANK.map((b) => b[0])).size === TQ.BANK.length, "tq bank: no duplicate questions");
  const qs = TQ.fromBank(10, rng);
  ok(qs.length === 10 && qs.every((q) => q.answers[q.correct] !== undefined), "tq: fromBank builds questions");
  ok(qs.filter((q) => q.answers.length === 2).every((q) => q.answers[0] === "True"), "tq: true/false keeps True first");
  const enc = (o) => ({ ...o, question: encodeURIComponent(o.question), correct_answer: encodeURIComponent(o.correct_answer), incorrect_answers: o.incorrect_answers.map(encodeURIComponent), category: encodeURIComponent(o.category) });
  ok(TQ.kidSafe(enc({ category: "Animals", question: "What do cows drink?", correct_answer: "Water", incorrect_answers: ["Milk", "Juice", "Soda"] })), "tq: kid-safe question allowed");
  ok(!TQ.kidSafe(enc({ category: "Entertainment: Music", question: "Who sang?", correct_answer: "A", incorrect_answers: ["B", "C", "D"] })), "tq: Music blocked in kids mode");
  ok(!TQ.kidSafe(enc({ category: "History", question: "Who won?", correct_answer: "A", incorrect_answers: ["B", "C", "D"] })), "tq: History blocked in kids mode");
  ok(!TQ.kidSafe(enc({ category: "Entertainment: Film", question: "Which beer brand...", correct_answer: "A", incorrect_answers: ["B", "C", "D"] })), "tq: word filter");
  ok(!TQ.kidSafe(enc({ category: "Entertainment: Video Games", question: "Who founded Team Fortress 2's Mann Co?", correct_answer: "A", incorrect_answers: ["B", "C", "D"] })), "tq: mature title filter");
  ok(TQ.kidSafe(enc({ category: "Entertainment: Video Games", question: "What is the name of Mario's brother?", correct_answer: "Luigi", incorrect_answers: ["Wario", "Toad", "Yoshi"] })), "tq: Mario allowed");
  // game flow
  let s = TQ.openSetup(TQ.initialState(), seated(3), 0);
  ok(s.phase === "setup" && Object.keys(s.scores).length === 3, "tq: setup with 3 players");
  s = TQ.beginLoading(s, { level: "easy", count: 10 }, 1);
  s = TQ.startQuiz(s, qs, 1000);
  ok(s.phase === "question" && s.qn === 1 && !("correct" in s.q), "tq: question 1, answer hidden from state");
  let picks = {};
  let r = TQ.answer(s, picks, "p1", qs[0].correct, 1000); s = r.state; picks = r.picks;
  ok(TQ.answer(s, picks, "p1", 0, 1100).error, "tq: can't answer twice");
  r = TQ.answer(s, picks, "p2", (qs[0].correct + 1) % qs[0].answers.length, 15000); s = r.state; picks = r.picks;
  ok(!TQ.allAnswered(s), "tq: not everyone answered");
  r = TQ.answer(s, picks, "p3", qs[0].correct, 1000 + TQ.turnMs(s) / 2); s = r.state; picks = r.picks;
  ok(TQ.allAnswered(s), "tq: everyone answered");
  s = TQ.reveal(s, picks, qs[0].correct, 9000);
  ok(s.scores.p1 === 1000 && s.scores.p2 === 0 && s.scores.p3 === 750, `tq: speed scoring (${s.scores.p1}, ${s.scores.p2}, ${s.scores.p3})`);
  for (let i = 0; i < 9; i++) { s = TQ.next(s, qs, 10000 + i); s = TQ.reveal(s, {}, qs[s.qn - 1].correct, 10000 + i); }
  s = TQ.next(s, qs, 20000);
  ok(s.phase === "gameOver" && TQ.ranking(s)[0] === "p1", "tq: game over after 10 questions, p1 leads");
  ok(TQ.syncPlayers(s, { ...seated(3), p4: { name: "Late" } }).scores.p4 === 0, "tq: late joiner added with 0");
  // fetch fallbacks (fake network)
  const noWait = async () => {};
  const fake = (responses) => { let i = 0; return async () => ({ json: async () => responses[Math.min(i++, responses.length - 1)] }); };
  const api = (n) => ({ response_code: 0, results: Array.from({ length: n }, (_, i) => enc({ type: "multiple", difficulty: "easy", category: i % 2 ? "Animals" : "Politics", question: "Q" + i + "?", correct_answer: "A" + i, incorrect_answers: ["B", "C", "D"] })) });
  let f = await TQ.fetchQuestions({ level: "easy", cat: "any", count: 10 }, { fetchFn: fake([{ response_code: 5 }, api(10)]), wait: noWait, rng });
  ok(f.questions.length === 10 && f.source === "opentdb", "tq: retries after rate limit");
  f = await TQ.fetchQuestions({ level: "hard", cat: 9, count: 15 }, { fetchFn: async () => { throw new Error("offline"); }, wait: noWait, rng });
  ok(f.questions.length === 15 && f.source === "bank", "tq: offline falls back to built-in questions");
  f = await TQ.fetchQuestions({ level: "kids", cat: "any", count: 10 }, { fetchFn: fake([api(50)]), wait: noWait, rng });
  ok(f.questions.length === 10 && f.questions.every((q) => q.category !== "Politics"), "tq: kids mode drops non-kid categories");
  // real network (skipped when offline)
  if (!process.env.OFFLINE) {
    const t0 = Date.now();
    const live = await TQ.fetchQuestions({ level: "kids", cat: "any", count: 15 }, { rng });
    console.log(`trivia live kids: ${live.questions.length} questions from ${live.source} in ${Date.now() - t0}ms; e.g. "${live.questions.find((q) => q.category !== "Kids' Trivia")?.text}"`);
    ok(live.questions.length === 15, "tq live: kids returns 15");
    await new Promise((r) => setTimeout(r, 5500));
    const hard = await TQ.fetchQuestions({ level: "hard", cat: 22, count: 10 }, { rng });
    console.log(`trivia live hard geography: ${hard.questions.length} from ${hard.source}; e.g. "${hard.questions[0].text}" -> ${hard.questions[0].answers[hard.questions[0].correct]}`);
    ok(hard.questions.length === 10, "tq live: hard geography returns 10");
  }
}

/* ------------------------------------------------------------- Scribble */
{
  const N = SC.N, at = (r, c) => r * N + c, E = SC.EMPTY_BOARD;
  ok(SC.FULL_BAG.length === 70, "sc: 70 tiles");
  ok(SC.prem(SC.CENTER) === "*" && SC.prem(0) === "W3" && SC.prem(120) === "W3", "sc: premium layout");
  let e = SC.evaluatePlay(E, "CATSXYZ", [{ i: at(0, 0), l: "C" }, { i: at(0, 1), l: "A" }]);
  ok(e.error && /★/.test(e.error), "sc: first word must cover center");
  e = SC.evaluatePlay(E, "CATSXYZ", [{ i: at(5, 4), l: "C" }, { i: at(5, 5), l: "A" }, { i: at(5, 6), l: "T" }]);
  ok(!e.error && e.total === 18 && e.words[0].w === "CAT", "sc: CAT across the center scores 18 (got " + e.total + ")");
  ok(e.rack === "SXYZ", "sc: rack loses played tiles");
  const b1 = e.board;
  ok(SC.evaluatePlay(b1, "SXYZ", [{ i: at(5, 4), l: "S" }]).error, "sc: occupied square rejected");
  ok(SC.evaluatePlay(b1, "SXYZ", [{ i: at(0, 0), l: "S" }, { i: at(0, 1), l: "X" }]).error, "sc: disconnected word rejected");
  ok(SC.evaluatePlay(b1, "SXYZ", [{ i: at(6, 4), l: "S" }, { i: at(7, 5), l: "X" }]).error, "sc: diagonal rejected");
  ok(SC.evaluatePlay(b1, "SXYZ", [{ i: at(5, 8), l: "S" }]).error, "sc: gap rejected");
  ok(SC.evaluatePlay(b1, "SXYZ", [{ i: at(5, 7), l: "Q" }]).error, "sc: tile not in rack rejected");
  e = SC.evaluatePlay(b1, "SXYZ", [{ i: at(5, 7), l: "S" }]);
  ok(!e.error && e.words.length === 1 && e.words[0].w === "CATS", "sc: hook S makes CATS");
  e = SC.evaluatePlay(b1, "?XYZ", [{ i: at(6, 4), l: "?", as: "O" }, { i: at(6, 5), l: "X" }]);
  ok(!e.error && e.words.map((w) => w.w).sort().join() === "AX,CO,OX", "sc: parallel play makes cross words (" + (e.words || []).map((w) => w.w) + ")");
  ok(e.words.find((w) => w.w === "CO").s === 3, "sc: blank scores 0");
  ok(SC.evaluatePlay(b1, "?XYZ", [{ i: at(6, 4), l: "?" }]).error, "sc: blank needs a letter");
  e = SC.evaluatePlay(E, "ABCDEFG", "ABCDEFG".split("").map((l, k) => ({ i: at(5, 2 + k), l })));
  ok(!e.error && e.bingo && e.total >= 50, "sc: all 7 tiles = +50");
  // wrap-around must not join rows
  const edge = E.split(""); edge[at(4, 10)] = "A"; edge[at(5, 0)] = "B";
  ok(SC.evaluatePlay(edge.join(""), "T", [{ i: at(4, 9), l: "T" }]).words[0].w === "TA", "sc: words don't wrap rows");
  // flow: start, pass x4 ends a 2-player game
  let g = SC.startGame(SC.initialState(), seated(2), 0, rng);
  ok(g.state.turn === "p1" && g.secret.racks.p1.length === 7 && g.secret.bag.length === 56, "sc: deal 7 each");
  let r = g;
  for (let k = 0; k < 4; k++) r = SC.passTurn(r.state, r.secret, r.state.turn, k);
  ok(r.state.phase === "gameOver" && !r.state.outBy, "sc: 2 rounds of passes ends the game");
  ok(Object.values(r.state.scores).every((v) => v <= 0), "sc: leftovers count against you");
  ok(SC.swapTiles(g.state, g.secret, "p2", "A", 1).error, "sc: swap out of turn rejected");
  // random simulations: tile conservation + games end
  let ended = 0;
  for (let game = 0; game < 150; game++) {
    let st = SC.startGame({ game_no: game }, seated(2 + (game % 3)), 0, rng);
    let steps = 0;
    while (st.state.phase === "playing" && steps++ < 500) {
      const s = st.state, sec = st.secret, seat = s.turn, rack = sec.racks[seat];
      let res = null;
      for (let tries = 0; tries < 60 && !res; tries++) {
        const n = 1 + Math.floor(rng() * Math.min(4, rack.length));
        const horiz = rng() < 0.5, r0 = Math.floor(rng() * N), c0 = Math.floor(rng() * N);
        const tiles = [], letters = [...rack];
        let r1 = r0, c1 = c0;
        while (tiles.length < n && r1 < N && c1 < N) {
          const i = at(r1, c1);
          if (s.board[i] === ".") { const l = letters.splice(Math.floor(rng() * letters.length), 1)[0]; tiles.push({ i, l, as: l === "?" ? "E" : undefined }); }
          horiz ? c1++ : r1++;
        }
        const ev = SC.evaluatePlay(s.board, rack, tiles);
        if (!ev.error) res = SC.commitPlay(s, sec, seat, ev, steps);
      }
      if (!res) res = sec.bag.length >= 2 && rng() < 0.5 ? SC.swapTiles(s, sec, seat, rack.slice(0, 2), steps, rng) : SC.passTurn(s, sec, seat, steps);
      st = res;
      const onBoard = st.state.board.split(".").join("").length;
      const inRacks = Object.values(st.secret.racks).join("").length;
      if (onBoard + inRacks + st.secret.bag.length !== 70) { ok(false, "sc sim: tiles not conserved"); break; }
    }
    if (st.state.phase === "gameOver") ended++;
    if (st.state.outBy) ok(st.state.final[st.state.outBy] === Object.entries(st.state.final).filter(([k]) => k !== st.state.outBy).reduce((a, [, v]) => a - v, 0), "sc sim: going out collects leftovers");
  }
  ok(ended === 150, "sc sim: every game ends (" + ended + "/150)");
  // dictionary client (fake network)
  const fakeCheck = async (url) => ({ ok: true, json: async () => ({ results: url.split("/check/")[1].split(",").map((w) => ({ word: w, valid: w !== "xqz" })) }) });
  let c = await SC.checkWords(["CAT", "XQZ"], fakeCheck);
  ok(c.invalid?.length === 1 && c.invalid[0] === "XQZ", "sc: invalid word reported");
  c = await SC.checkWords(["DOGGO"], async () => { throw new Error("offline"); });
  ok(c.offline, "sc: offline is reported, not thrown");
  if (!process.env.OFFLINE) {
    const live = await SC.checkWords(["QI", "ZA", "SCRIBBLE", "XYZZY"]);
    ok(live.invalid && live.invalid.join() === "XYZZY", "sc live: WordSoHard check (" + JSON.stringify(live) + ")");
    const d = await SC.defineWord("scribble");
    console.log("scribble live define:", d && d.text);
    ok(d && d.text.length > 5, "sc live: definition");
  }
}

console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nALL ${checks} CHECKS PASSED`);
process.exit(fails ? 1 : 0);
