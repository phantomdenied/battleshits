// games.js — the list of games the TV can host. To add a game: write a module
// exporting id, initialState, normalizeState, createHost and createPhone, then
// add it here. platform.js, tv.html and play.html don't need to change.
import * as battleshits from "./battleshits.js";
import * as connect4 from "./connect4.js";
import * as hangman from "./hangman.js";
import * as blackjack from "./blackjack.js";
import * as trivia from "./trivia.js";
import { seatList } from "./kit.js";

export const GAMES = {
  battleshits: { mod: battleshits, name: "Battleshits", icon: "🚢", blurb: "Battleship · 2 players", seats: seatList(2) },
  connect4: { mod: connect4, name: "Connect 4", icon: "🔴", blurb: "Four in a row · 2 players", seats: seatList(2) },
  hangman: { mod: hangman, name: "Hangman", icon: "🔤", blurb: "Guess the word · 2–8 players", seats: seatList(8) },
  trivia: { mod: trivia, name: "Trivia", icon: "❓", blurb: "Quiz with Kids (10+) mode · 1–8 players", seats: seatList(8), joinMidGame: true },
  blackjack: { mod: blackjack, name: "Blackjack", icon: "🃏", blurb: "Beat the dealer · 1–6 players", seats: seatList(6), joinMidGame: true },
};
export const GAME_IDS = Object.keys(GAMES);
export const gameId = (state) => (GAMES[state?.game] ? state.game : "battleshits");
export const freshState = (id) => ({ ...GAMES[id].mod.initialState(), game: id });
