// Run: node dev/engine.test.mjs   (no npm needed)
import * as E from "../battleshits.js";
import { simulate } from "./sim.js";

let failed = 0;
const t = (name, fn) => {
  try { fn(); console.log("  ok  ", name); } catch (e) { failed++; console.log("  FAIL", name, "-", e.message); }
};
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const F = [
  { len: 5, r: 0, c: 0, dir: "h" }, { len: 4, r: 1, c: 0, dir: "h" }, { len: 3, r: 2, c: 0, dir: "h" },
  { len: 3, r: 3, c: 0, dir: "h" }, { len: 2, r: 4, c: 0, dir: "h" },
];

t("touching ships are allowed", () => eq(E.validateFleet(F), null, "valid"));
t("overlap rejected", () => eq(E.validateFleet([F[0], { ...F[1], r: 0 }, F[2], F[3], F[4]]), "Ships overlap", "overlap"));
t("out of bounds rejected", () => eq(E.validateFleet([F[0], F[1], F[2], F[3], { len: 2, r: 9, c: 9, dir: "h" }]), "Ship out of bounds", "oob"));
t("wrong sizes rejected", () => eq(E.validateFleet([F[1], F[0], F[2], F[3], F[4]]), "Wrong ship sizes", "sizes"));
t("random fleets are always valid", () => { for (let i = 0; i < 500; i++) if (E.validateFleet(E.randomFleet())) throw new Error("invalid random fleet"); });

t("hit grants another shot, miss passes turn, sink + win", () => {
  let s = E.startPlacement(E.initialState());
  let fl = {};
  for (const seat of ["p1", "p2"]) { const r = E.placeFleet(s, fl, seat, F, 0); s = r.state; fl = r.fleets; }
  eq(s.phase, "battle", "phase");
  let r = E.fire(s, fl, "p1", 0, 0, 1); eq(r.event.result, "hit", "hit"); eq(r.state.turn, "p1", "keeps turn");
  r = E.fire(r.state, fl, "p1", 9, 9, 2); eq(r.event.result, "miss", "miss"); eq(r.state.turn, "p2", "turn passes");
  s = r.state;
  // p2 sinks everything
  let n = 0;
  for (const sh of F) for (const [a, b] of E.shipCells(sh)) { r = E.fire(s, fl, "p2", a, b, 10 + n++); s = r.state; }
  eq(s.phase, "gameOver", "game over"); eq(s.winner, "p2", "winner"); eq(s.tally, { p1: 0, p2: 1 }, "tally");
});

t("timeout fires a random unshot cell for the current player", () => {
  let s = E.startPlacement(E.initialState()); let fl = {};
  for (const seat of ["p1", "p2"]) { const r = E.placeFleet(s, fl, seat, F, 0); s = r.state; fl = r.fleets; }
  const r = E.timeoutShot(s, fl, s.timerEndsAt + 1);
  eq(r.event.by, "p1", "shooter"); eq(r.event.auto, true, "auto");
});

console.log("\nSimulating 300 full games with rematches…");
const res = simulate({ games: 300, seed: 42 });
console.log("  stats:", res.stats);
if (!res.ok) { failed++; console.log("  FAIL simulation:\n   - " + [...new Set(res.failures)].slice(0, 20).join("\n   - ")); }
else console.log("  ok   all invariants held");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
