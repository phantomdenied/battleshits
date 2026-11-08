// dev/sim.js — shared simulation helpers for the harness and node tests.
// Plays complete games against the pure engine with simulated players and
// checks the rules after every step. No Firebase, no DOM.
import * as E from "../battleshits.js";

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A bot that hunts around unsunk hits, otherwise shoots at random.
export function botPick(s, seat, rng) {
  const mine = s.shotLog.filter((x) => x.by === seat);
  const shot = new Set(mine.map((x) => x.r * 10 + x.c));
  const sunkCells = new Set();
  // we don't know sunk ship cells exactly; approximate: hits that are part of a sunk event chain are ignored
  const hits = mine.filter((x) => x.result === "hit");
  const cand = [];
  for (const h of hits) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const r = h.r + dr, c = h.c + dc;
    if (r >= 0 && c >= 0 && r < 10 && c < 10 && !shot.has(r * 10 + c) && !sunkCells.has(r * 10 + c)) cand.push([r, c]);
  }
  if (cand.length && rng() < 0.85) return cand[Math.floor(rng() * cand.length)];
  const open = E.unshotCells(s, seat);
  return open[Math.floor(rng() * open.length)];
}

const leaksFleet = (s) => s.phase !== "gameOver" && /"len"/.test(JSON.stringify({ ...s, reveal: null }));

/**
 * Play `games` full games (with rematches) and return { ok, failures, stats }.
 * opts.timeoutRate: chance a bot "falls asleep" so the turn timer auto-fires.
 */
export function simulate({ games = 20, seed = 1, timeoutRate = 0.08, onStep } = {}) {
  const rng = mulberry32(seed);
  const failures = [];
  const fail = (m) => { failures.push(m); };
  let s = E.initialState();
  let fleets = {};
  let t = 1_000_000;
  const stats = { games: 0, shots: 0, autoShots: 0, bonusShots: 0, hits: 0, sunk: 0 };

  s = E.startPlacement(s);
  for (let g = 0; g < games; g++) {
    // ---- placement
    if (s.phase !== "placement") fail(`game ${g}: expected placement, got ${s.phase}`);
    // invalid fleets must be rejected
    const bad = E.randomFleet(rng); bad[1] = { ...bad[0] };
    if (!E.placeFleet(s, fleets, "p1", bad, t).error) fail("overlapping fleet accepted");
    const oob = E.randomFleet(rng); oob[4] = { len: 2, r: 9, c: 9, dir: "h" };
    if (!E.placeFleet(s, fleets, "p2", oob, t).error) fail("out-of-bounds fleet accepted");
    for (const seat of ["p1", "p2"]) {
      const r = E.placeFleet(s, fleets, seat, E.randomFleet(rng), t);
      if (r.error) fail(`valid fleet rejected: ${r.error}`);
      s = r.state; fleets = r.fleets;
      onStep?.({ s, fleets, kind: "place", seat });
    }
    if (s.phase !== "battle") fail(`expected battle after both placed, got ${s.phase}`);
    const expectStarter = s.round % 2 === 1 ? "p1" : "p2";
    if (s.turn !== expectStarter) fail(`round ${s.round}: ${s.turn} started, expected ${expectStarter}`);

    // ---- battle
    let guard = 0;
    while (s.phase === "battle" && guard++ < 400) {
      if (leaksFleet(s)) fail("state contains fleet data during battle");
      const seat = s.turn;
      // wrong player can't fire
      if (!E.fire(s, fleets, E.other(seat), 0, 0, t).error) fail("out-of-turn shot accepted");
      let res;
      if (rng() < timeoutRate) {
        t = s.timerEndsAt + 1;
        res = E.timeoutShot(s, fleets, t, rng);
        if (!res.event?.auto) fail("timeout shot not marked auto");
        stats.autoShots++;
      } else {
        t += 1500;
        const [r, c] = botPick(s, seat, rng);
        res = E.fire(s, fleets, seat, r, c, t);
        if (!res.error && !E.fire(res.state, fleets, seat, r, c, t).error && res.state.turn === seat && res.state.phase === "battle") fail("duplicate shot accepted");
      }
      if (res.error) { fail(`shot error: ${res.error}`); break; }
      const ev = res.event;
      stats.shots++;
      if (ev.result !== "miss") { stats.hits++; if (res.state.phase === "battle") { if (res.state.turn !== seat) fail("hit did not grant another shot"); else stats.bonusShots++; } }
      if (ev.result === "miss" && res.state.turn === seat) fail("miss did not pass the turn");
      if (ev.result === "hit" && ev.ship != null) fail("hit revealed ship index before sinking");
      if (ev.result === "sunk") stats.sunk++;
      if (res.state.phase === "battle" && res.state.timerEndsAt !== t + E.TURN_MS) fail("turn timer not reset after shot");
      s = res.state;
      onStep?.({ s, fleets, kind: "shot", ev });
    }
    if (s.phase !== "gameOver") { fail(`game ${g} did not finish`); break; }
    const loser = E.other(s.winner);
    if (s.sunk[loser].length !== 5) fail("winner declared before all ships sunk");
    if (!s.reveal?.p1 || !s.reveal?.p2) fail("fleets not revealed at game over");
    stats.games++;
    if (s.tally.p1 + s.tally.p2 !== stats.games) fail(`tally ${s.tally.p1}+${s.tally.p2} != ${stats.games}`);

    // ---- rematch
    if (!E.requestRematch(s, "spectator").error) fail("spectator rematch accepted");
    let r = E.requestRematch(s, "p1");
    if (r.restarted) fail("rematch restarted with only one vote");
    s = r.state;
    r = E.requestRematch(s, "p2");
    if (!r.restarted) fail("rematch did not restart with both votes");
    s = r.state;
    fleets = {};
    onStep?.({ s, fleets, kind: "rematch" });
  }
  // normalizeState round-trips through a Firebase-like JSON (drops [] and null)
  const firebaseish = JSON.parse(JSON.stringify(s, (k, v) => (v === null || (Array.isArray(v) && !v.length) ? undefined : v)));
  const n = E.normalizeState(firebaseish);
  if (!Array.isArray(n.shotLog) || !Array.isArray(n.sunk.p1)) fail("normalizeState did not restore arrays");
  return { ok: failures.length === 0, failures, stats };
}
