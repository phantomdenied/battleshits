// trivia.js — Trivia for 1–8 players. Questions come from the Open Trivia
// Database (opentdb.com, free, CC BY-SA 4.0) with a built-in kid-friendly bank
// as a top-up and offline fallback. Everyone answers at once on their phone;
// faster correct answers score more. The host picks the level, category and
// length on the TV. "Kids (10+)" = easy questions from kid-friendly categories,
// a word filter, and the built-in bank mixed in.
import { esc, arr, seatList, pick, tvLayers, handleEmote, ringHTML, updateRing, tickSound, overControlsHTML, wireOverControls, emoteBarHTML, wireEmotes, phoneTimer } from "./kit.js";

export const id = "trivia";
export const SEATS = seatList(8);
export const REVEAL_MS = 7000, BASE_PTS = 500, SPEED_PTS = 500;
export const LEVELS = {
  kids: { name: "Kids (10+)", api: "easy", ms: 25000 },
  easy: { name: "Easy", api: "easy", ms: 20000 },
  medium: { name: "Medium", api: "medium", ms: 20000 },
  hard: { name: "Hard", api: "hard", ms: 20000 },
  mixed: { name: "Mixed", api: "", ms: 20000 },
};
export const CATEGORIES = [
  { id: "any", name: "Everything" }, { id: 9, name: "General" }, { id: 27, name: "Animals" }, { id: 17, name: "Science" },
  { id: 22, name: "Geography" }, { id: 21, name: "Sports" }, { id: 11, name: "Movies" }, { id: 32, name: "Cartoons" },
  { id: 15, name: "Video Games" }, { id: 12, name: "Music" }, { id: 23, name: "History" }, { id: 14, name: "TV" },
];
// Open Trivia DB category names we allow in Kids mode.
const KID_CATS = new Set([
  "General Knowledge", "Science & Nature", "Animals", "Geography", "Sports", "Entertainment: Video Games",
  "Entertainment: Cartoon & Animations", "Entertainment: Comics", "Entertainment: Board Games",
]);
const KID_BLOCK = /\b(sex\w*|drugs?|alcohol\w*|beer|wine|vodka|whiske?y|liquor|drunk|kill\w*|murder\w*|death|dead|dies?|died|suicide|wars?|nazis?|hitler|guns?|bombs?|weapons?|blood\w*|naked|nude|porn\w*|cocaine|marijuana|cannabis|cigarettes?|tobacco|smok\w*|prison|hell|damn|assassin\w*|terror\w*|genocide|slave\w*|execut\w*|gambl\w*|casino)\b/i;
// Mature-rated franchises that turn up in easy Video Games / Film / TV questions.
const KID_BLOCK_TITLES = /(team fortress|grand theft|\bgta\b|call of duty|\bhalo\b|\bdoom\b|mortal kombat|resident evil|counter-strike|fallout|bioshock|silent hill|dead space|left 4 dead|gears of war|hitman|battlefield|witcher|saints row|god of war|duke nukem|far cry|metal gear|half-life|five nights at freddy|outlast|borderlands|overwatch|rainbow six|street fighter|tekken|deadpool|pulp fiction|tarantino|\bsaw\b|horror|zombie|walking dead|game of thrones|breaking bad|south park|family guy|rick and morty|sopranos|scarface|godfather|\balien\b|predator|terminator|rambo|die hard|friday the 13th|halloween|nightmare on elm|chucky|\bscream\b|exorcist|stephen king|r-rated|rated r|playboy|bikini|the dictator|scp|doki doki|dark souls|souls|steins|rowdy rebel|dabbing|twitch streamer|lil |homicide|persona|fortnite kill|schr.dinger)/i;
export const COUNTS = [10, 15, 20];
const KID_HIDDEN = new Set([23, 11, 12, 14]); // History, Movies, Music, TV: too much grown-up stuff for Kids mode
export const LETTERS = ["A", "B", "C", "D"];

/* Built-in questions: [question, correct, ...wrong]. Two answers = true/false. */
export const BANK = [
  ["How many legs does a spider have?", "8", "6", "10", "12"],
  ["What is the largest planet in our solar system?", "Jupiter", "Saturn", "Earth", "Neptune"],
  ["What color do you get when you mix blue and yellow?", "Green", "Purple", "Orange", "Brown"],
  ["Which animal is often called the King of the Jungle?", "Lion", "Tiger", "Elephant", "Gorilla"],
  ["How many continents are there on Earth?", "7", "5", "6", "8"],
  ["What is the largest ocean on Earth?", "Pacific Ocean", "Atlantic Ocean", "Indian Ocean", "Arctic Ocean"],
  ["What do bees make?", "Honey", "Milk", "Silk", "Butter"],
  ["Which planet is known as the Red Planet?", "Mars", "Venus", "Jupiter", "Mercury"],
  ["At what temperature does water freeze in Celsius?", "0°C", "10°C", "32°C", "-10°C"],
  ["How many days are in a leap year?", "366", "365", "364", "367"],
  ["What is the tallest animal in the world?", "Giraffe", "Elephant", "Ostrich", "Horse"],
  ["What gas do plants take in from the air to make food?", "Carbon dioxide", "Oxygen", "Helium", "Hydrogen"],
  ["Which river is the longest in Africa?", "The Nile", "The Amazon", "The Congo", "The Zambezi"],
  ["How many sides does a hexagon have?", "6", "5", "7", "8"],
  ["What is the capital city of France?", "Paris", "London", "Rome", "Madrid"],
  ["What is the fastest land animal?", "Cheetah", "Lion", "Horse", "Greyhound"],
  ["Which bird lives in Antarctica and can't fly?", "Penguin", "Eagle", "Seagull", "Parrot"],
  ["What is 7 × 8?", "56", "54", "48", "64"],
  ["What is the closest star to Earth?", "The Sun", "Polaris", "Sirius", "Betelgeuse"],
  ["What do caterpillars turn into?", "Butterflies", "Bees", "Beetles", "Dragonflies"],
  ["How many players does a soccer team have on the field?", "11", "9", "10", "12"],
  ["What is the capital city of Japan?", "Tokyo", "Kyoto", "Osaka", "Beijing"],
  ["Which instrument usually has 88 keys?", "Piano", "Guitar", "Violin", "Trumpet"],
  ["What is the hardest natural material?", "Diamond", "Gold", "Iron", "Glass"],
  ["What is a baby kangaroo called?", "Joey", "Kit", "Cub", "Calf"],
  ["Which planet has the most famous rings?", "Saturn", "Mars", "Venus", "Mercury"],
  ["What is H₂O better known as?", "Water", "Salt", "Oxygen", "Sugar"],
  ["In which country do kangaroos live in the wild?", "Australia", "Canada", "Brazil", "India"],
  ["What do you call a scientist who studies dinosaur fossils?", "Paleontologist", "Astronaut", "Botanist", "Meteorologist"],
  ["What is the largest animal that has ever lived?", "Blue whale", "T. rex", "African elephant", "Great white shark"],
  ["How many colors are in a rainbow?", "7", "5", "6", "8"],
  ["Which organ pumps blood around your body?", "Heart", "Lungs", "Brain", "Stomach"],
  ["What is the capital city of Italy?", "Rome", "Venice", "Milan", "Naples"],
  ["What is 100 divided by 4?", "25", "20", "40", "50"],
  ["Which animal can change its color to blend in?", "Chameleon", "Frog", "Rabbit", "Turtle"],
  ["What language do most people speak in Brazil?", "Portuguese", "Spanish", "English", "French"],
  ["At what temperature does water boil at sea level in Celsius?", "100°C", "50°C", "90°C", "212°C"],
  ["Which famous ship sank in 1912 after hitting an iceberg?", "Titanic", "Mayflower", "Santa Maria", "Queen Mary"],
  ["Who painted the Mona Lisa?", "Leonardo da Vinci", "Pablo Picasso", "Vincent van Gogh", "Claude Monet"],
  ["Which is the smallest planet in our solar system?", "Mercury", "Mars", "Venus", "Earth"],
  ["What do giant pandas mostly eat?", "Bamboo", "Fish", "Berries", "Insects"],
  ["How many bones are in an adult human body?", "206", "106", "300", "156"],
  ["What is the largest hot desert in the world?", "Sahara", "Gobi", "Kalahari", "Mojave"],
  ["In which sport can you score a slam dunk?", "Basketball", "Tennis", "Golf", "Baseball"],
  ["How many minutes are in an hour?", "60", "100", "30", "90"],
  ["What is the capital of the United States?", "Washington, D.C.", "New York City", "Los Angeles", "Chicago"],
  ["What is the name of our galaxy?", "The Milky Way", "Andromeda", "The Sombrero", "The Whirlpool"],
  ["What kind of animal is a dolphin?", "Mammal", "Fish", "Reptile", "Amphibian"],
  ["How many strings does a standard guitar have?", "6", "4", "5", "8"],
  ["What force pulls things down toward the Earth?", "Gravity", "Magnetism", "Friction", "Wind"],
  ["Which continent is Egypt in?", "Africa", "Asia", "Europe", "South America"],
  ["What is the largest country in the world by area?", "Russia", "Canada", "China", "United States"],
  ["How many sides does a stop sign have?", "8", "6", "5", "10"],
  ["What is the main ingredient in guacamole?", "Avocado", "Tomato", "Cucumber", "Pea"],
  ["Which planet is closest to the Sun?", "Mercury", "Venus", "Earth", "Mars"],
  ["How many hearts does an octopus have?", "3", "1", "2", "8"],
  ["Which shape has only three sides?", "Triangle", "Square", "Pentagon", "Circle"],
  ["What is the biggest bone in the human body?", "Femur (thigh bone)", "Skull", "Spine", "Rib"],
  ["Which is the only mammal that can truly fly?", "Bat", "Flying squirrel", "Sugar glider", "Penguin"],
  ["What is the capital city of Canada?", "Ottawa", "Toronto", "Vancouver", "Montreal"],
  ["The Sun is a star.", "True", "False"],
  ["Bats are completely blind.", "False", "True"],
  ["A tomato is a fruit.", "True", "False"],
  ["Sound travels faster than light.", "False", "True"],
  ["Frogs can breathe through their skin.", "True", "False"],
  ["Penguins live at the North Pole.", "False", "True"],
  ["Spiders are insects.", "False", "True"],
  ["The Pacific is the largest ocean on Earth.", "True", "False"],
  ["Humans have four lungs.", "False", "True"],
  ["Lightning is hotter than the surface of the Sun.", "True", "False"],
  ["What do you call a group of lions?", "A pride", "A pack", "A herd", "A flock"],
  ["How many teeth does an adult human usually have?", "32", "28", "24", "36"],
  ["Which planet has a giant storm called the Great Red Spot?", "Jupiter", "Mars", "Saturn", "Neptune"],
  ["What is the largest bird in the world?", "Ostrich", "Eagle", "Albatross", "Flamingo"],
  ["What is the largest land animal?", "African elephant", "Hippopotamus", "Rhinoceros", "Giraffe"],
  ["What is the capital city of the United Kingdom?", "London", "Manchester", "Liverpool", "Edinburgh"],
  ["How many centimeters are in one meter?", "100", "10", "1,000", "50"],
  ["What is the plural of “mouse”?", "Mice", "Mouses", "Meese", "Mousen"],
  ["Which is the coldest continent?", "Antarctica", "Europe", "Asia", "North America"],
  ["Which sea creature has eight arms?", "Octopus", "Starfish", "Crab", "Jellyfish"],
  ["What do you call animals that eat only plants?", "Herbivores", "Carnivores", "Omnivores", "Insectivores"],
  ["What is the name of the cowboy toy in Toy Story?", "Woody", "Buzz", "Jessie", "Andy"],
  ["What color is a polar bear's skin?", "Black", "White", "Pink", "Brown"],
  ["How many planets are in our solar system?", "8", "9", "7", "10"],
  ["Which gas makes up most of the air we breathe?", "Nitrogen", "Oxygen", "Carbon dioxide", "Helium"],
  ["In which city is the Statue of Liberty?", "New York City", "Washington, D.C.", "Boston", "Chicago"],
  ["What is the square root of 81?", "9", "8", "7", "18"],
  ["Which month has the fewest days?", "February", "April", "June", "November"],
  ["What is the name of Ash's yellow Pokémon partner?", "Pikachu", "Psyduck", "Meowth", "Jigglypuff"],
  ["In Minecraft, which green mob explodes when it gets close?", "Creeper", "Enderman", "Slime", "Skeleton"],
  ["What is the name of Mario's brother?", "Luigi", "Wario", "Toad", "Yoshi"],
  ["Which ocean lies between Europe and North America?", "Atlantic Ocean", "Pacific Ocean", "Indian Ocean", "Arctic Ocean"],
  ["What is the largest organ of the human body?", "Skin", "Heart", "Liver", "Brain"],
  ["How many weeks are in a year?", "52", "48", "50", "56"],
  ["What do you call a baby dog?", "Puppy", "Kitten", "Cub", "Foal"],
  ["How many sides does a pentagon have?", "5", "4", "6", "8"],
  ["Which country is shaped like a boot?", "Italy", "Spain", "Greece", "Portugal"],
  ["What is 12 × 12?", "144", "124", "132", "164"],
  ["Which animal is known for building dams?", "Beaver", "Otter", "Raccoon", "Squirrel"],
  ["What do you call frozen rain that falls as little balls of ice?", "Hail", "Fog", "Dew", "Mist"],
  ["Goldfish can only remember things for three seconds.", "False", "True"],
  ["The Moon makes its own light.", "False", "True"],
  ["Sharks are mammals.", "False", "True"],
  ["Venus is the hottest planet in our solar system.", "True", "False"],
  ["A baby has more bones than an adult.", "True", "False"],
];

/* ---------------------------------------------------------------- engine */

function shuffle(a, rng = Math.random) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
/** Build a question {text, answers, correct, category, difficulty}. True/False keeps True first. */
export function makeQuestion(text, correct, wrong, meta = {}, rng = Math.random) {
  const answers = wrong.length === 1 ? ["True", "False"] : shuffle([correct, ...wrong], rng);
  return { text, answers, correct: answers.indexOf(correct), category: meta.category || "Trivia", difficulty: meta.difficulty || "easy" };
}
export function fromBank(n, rng = Math.random, exclude = new Set()) {
  return shuffle(BANK.filter((b) => !exclude.has(b[0])), rng).slice(0, n).map(([q, c, ...w]) => makeQuestion(q, c, w, { category: "Kids' Trivia" }, rng));
}
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
export function fromApi(results, rng = Math.random) {
  return results.map((r) => makeQuestion(dec(r.question), dec(r.correct_answer), r.incorrect_answers.map(dec), { category: dec(r.category).replace(/^(Entertainment|Science): /, ""), difficulty: r.difficulty }, rng));
}
export function kidSafe(r) {
  const cat = dec(r.category);
  const all = [r.question, r.correct_answer, ...r.incorrect_answers].map(dec).join(" ");
  return KID_CATS.has(cat) && !KID_BLOCK.test(all) && !KID_BLOCK_TITLES.test(all);
}

/** Fetch questions for the settings. Returns { questions, source }. Never throws: falls back to the bank. */
export async function fetchQuestions(settings, { rng = Math.random, fetchFn = globalThis.fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), token = null } = {}) {
  const lv = LEVELS[settings.level] || LEVELS.kids;
  const n = settings.count || 10;
  const kids = settings.level === "kids";
  const q = new URLSearchParams({ amount: String(kids ? 50 : n), encode: "url3986" });
  if (lv.api) q.set("difficulty", lv.api);
  if (settings.cat !== "any" && settings.cat) q.set("category", String(settings.cat));
  if (token) q.set("token", token);
  let results = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetchFn(`https://opentdb.com/api.php?${q}`);
      const j = await res.json();
      if (j.response_code === 5) { await wait(5500); continue; } // rate limited
      if (j.response_code === 4 && token) { q.delete("token"); continue; } // token used up: allow repeats
      if (j.response_code === 1 && Number(q.get("amount")) > 10) { q.set("amount", String(Math.max(10, Math.floor(Number(q.get("amount")) / 2)))); continue; } // not enough questions
      results = j.results || [];
      break;
    } catch { await wait(1500); }
  }
  let questions = [];
  if (kids) {
    const ok = results.filter(kidSafe);
    const fromDb = fromApi(ok, rng).slice(0, Math.floor(n / 2)); // at most half from the database
    questions = shuffle([...fromDb, ...fromBank(n - fromDb.length, rng)], rng);
  } else {
    questions = fromApi(results, rng).slice(0, n);
    if (questions.length < n) questions = [...questions, ...fromBank(n - questions.length, rng)];
  }
  return { questions: questions.slice(0, n), source: results.length ? "opentdb" : "bank" };
}

export function initialState() {
  return {
    game: id, phase: "lobby", settings: { level: "kids", cat: "any", count: 10 }, qn: 0, total: 0, q: null, answered: {},
    scores: {}, names: {}, reveal: null, timerEndsAt: null, phaseAt: null, source: null, plays: 0,
  };
}
export function normalizeState(s) {
  const b = initialState();
  if (!s) return b;
  const n = { ...b, ...s, game: id };
  n.settings = { ...b.settings, ...(s.settings || {}) };
  n.q = s.q ? { ...s.q, answers: arr(s.q.answers) } : null;
  n.answered = { ...(s.answered || {}) };
  n.scores = { ...(s.scores || {}) };
  n.names = { ...(s.names || {}) };
  n.reveal = s.reveal ? { correct: s.reveal.correct, picks: { ...(s.reveal.picks || {}) }, gained: { ...(s.reveal.gained || {}) } } : null;
  for (const k of ["timerEndsAt", "phaseAt", "source"]) n[k] = s[k] ?? null;
  return n;
}
export const turnMs = (s) => (LEVELS[s.settings.level] || LEVELS.kids).ms;
const publicQ = (q) => ({ text: q.text, answers: q.answers, category: q.category, difficulty: q.difficulty });

export function syncPlayers(s, seated) {
  const scores = { ...s.scores }, names = { ...s.names };
  let changed = false;
  for (const [k, v] of Object.entries(seated)) {
    if (!v) continue;
    if (!(k in scores)) { scores[k] = 0; changed = true; }
    if (names[k] !== v.name) { names[k] = v.name; changed = true; }
  }
  return changed ? { ...s, scores, names } : null;
}
export function openSetup(s, seated, now) {
  return { ...(syncPlayers({ ...s, scores: {}, names: {} }, seated) || s), phase: "setup", qn: 0, q: null, reveal: null, answered: {}, timerEndsAt: null, phaseAt: now };
}
export function beginLoading(s, settings, now) {
  return { ...s, phase: "loading", settings: { ...s.settings, ...settings }, phaseAt: now };
}
/** Start question number qn (1-based) from the secret question list. */
export function askQuestion(s, questions, qn, now) {
  const q = questions[qn - 1];
  return { ...s, phase: "question", qn, total: questions.length, q: publicQ(q), answered: {}, reveal: null, timerEndsAt: now + turnMs(s), phaseAt: now };
}
export function startQuiz(s, questions, now, source = null) {
  const scores = Object.fromEntries(Object.keys(s.scores).map((k) => [k, 0]));
  return askQuestion({ ...s, scores, source, plays: (s.plays || 0) + 1 }, questions, 1, now);
}
/** Record an answer. picks: secret map seat -> {i, t}. Returns {state, picks} or {error}. */
export function answer(s, picks, seat, i, now) {
  if (s.phase !== "question") return { error: "Too late!" };
  if (!(seat in s.scores)) return { error: "You'll join on the next question" };
  if (picks[seat]) return { error: "Already locked in" };
  if (!Number.isInteger(i) || i < 0 || i >= s.q.answers.length) return { error: "Pick an answer" };
  return { state: { ...s, answered: { ...s.answered, [seat]: true } }, picks: { ...picks, [seat]: { i, t: now } } };
}
export const allAnswered = (s, active = () => true) => {
  const who = Object.keys(s.scores).filter(active);
  return who.length > 0 && who.every((k) => s.answered[k]);
};
/** Points for a correct answer: 500 + up to 500 for speed. */
export function points(s, t) {
  const total = turnMs(s), start = s.timerEndsAt - total;
  const frac = Math.max(0, Math.min(1, 1 - (t - start) / total));
  return BASE_PTS + Math.round(SPEED_PTS * frac);
}
export function reveal(s, picks, correct, now) {
  const gained = {}, pub = {};
  for (const k of Object.keys(s.scores)) {
    const p = picks[k];
    if (!p) continue;
    pub[k] = p.i;
    gained[k] = p.i === correct ? points(s, p.t) : 0;
  }
  const scores = { ...s.scores };
  for (const [k, v] of Object.entries(gained)) scores[k] += v;
  return { ...s, phase: "reveal", scores, reveal: { correct, picks: pub, gained }, timerEndsAt: null, phaseAt: now };
}
export function next(s, questions, now) {
  if (s.qn >= questions.length) return { ...s, phase: "gameOver", timerEndsAt: null, phaseAt: now };
  return askQuestion(s, questions, s.qn + 1, now);
}
export const ranking = (s) => Object.keys(s.scores).sort((a, b) => s.scores[b] - s.scores[a]);

/* -------------------------------------------------------------- render */

const SKIN = {
  classic: { title: "Trivia", right: "CORRECT!", wrong: "WRONG", none: "TOO SLOW", champ: "TRIVIA CHAMP" },
  shit: { title: "Brain Dump", right: "NAILED IT!", wrong: "FLUSHED", none: "STILL ON THE POT", champ: "BIG BRAIN ON THE THRONE" },
};
const skin = (T) => SKIN[T.id] || SKIN.classic;
const nm = (s, k) => s.names[k] || `Player ${String(k).slice(1)}`;
const SHAPES = ["▲", "◆", "●", "■"];

function tilesHTML(s, { reveal = null, mine = null, tap = false } = {}) {
  const tf = s.q.answers.length === 2;
  return `<div class="tq-tiles ${tf ? "tf" : ""}">${s.q.answers.map((a, i) => {
    let cls = `tq-tile t${i}`;
    if (reveal) cls += i === reveal.correct ? " right" : " wrongans";
    if (mine === i) cls += " mine";
    const who = reveal ? Object.entries(reveal.picks).filter(([, v]) => v === i).map(([k]) => esc(nm(s, k))) : [];
    const inner = `<span class="sh">${tf ? (i === 0 ? "✔" : "✘") : SHAPES[i]}</span><span class="tx">${esc(a)}</span>${who.length ? `<span class="who">${who.join(", ")}</span>` : ""}`;
    return tap ? `<button class="${cls}" data-i="${i}">${inner}</button>` : `<div class="${cls}">${inner}</div>`;
  }).join("")}</div>`;
}
function boardHTML(s, { gained = false, limit = 8, from = 0 } = {}) {
  return `<ol class="tq-board">${ranking(s).slice(from, limit).map((k, r) => `<li><span class="r">${from + r + 1}</span><span class="n">${esc(nm(s, k))}</span>
    ${gained && s.reveal?.gained[k] ? `<span class="plus">+${s.reveal.gained[k]}</span>` : ""}<b>${s.scores[k]}</b></li>`).join("")}</ol>`;
}

/* ------------------------------------------------------------------- TV */

export function createHost() {
  let room = null, L = null, loadingFor = null;
  const lastEmoteAt = {}, tickMemo = {};
  const S = () => normalizeState(room.state);
  const Q = () => arr(room.secret?.questions).map((q) => ({ ...q, answers: arr(q.answers) }));
  const picks = () => ({ ...(room.secret?.picks || {}) });
  const active = (k) => { const u = room.uidForSeat(k); return !!u && room.isOnline(u); };
  const getToken = async () => {
    try {
      const t = localStorage.getItem("party.otdbToken");
      if (t) return t;
      const j = await (await fetch("https://opentdb.com/api_token.php?command=request")).json();
      if (j.token) localStorage.setItem("party.otdbToken", j.token);
      return j.token || null;
    } catch { return null; }
  };

  async function load(s) {
    const key = `${s.plays}:${s.phaseAt}`;
    if (loadingFor === key) return;
    loadingFor = key;
    const token = await getToken();
    const { questions, source } = await fetchQuestions(s.settings, { token });
    if (S().phase !== "loading") return;
    room.setSecret({ questions, picks: {} });
    room.setState(startQuiz(S(), questions, room.now(), source));
    room.sound("turn");
  }
  function doReveal(s) {
    const q = Q()[s.qn - 1];
    if (!q) return;
    const st = reveal(s, picks(), q.correct, room.now());
    room.setState(st);
    const any = Object.values(st.reveal.gained).some((v) => v > 0);
    room.sound(any ? "hit" : "miss");
  }

  const mod = {
    id,
    init(r) { room = r; L = tvLayers(r.el); },
    canStart() { return Object.values(room.seatInfo()).some(Boolean); },
    startHint() { return "Trivia needs at least 1 player"; },
    start() { if (mod.canStart()) { room.setState(openSetup(S(), room.seatInfo(), room.now())); room.sound("ready"); } },
    onPlayersChanged() {
      if (!room.state) return;
      const s = S();
      if (s.phase === "lobby") return;
      const n = syncPlayers(s, room.seatInfo());
      if (n) room.setState(n);
    },
    onSeatTransfer() {},
    onAction(uid, a) {
      if (handleEmote(room, L, lastEmoteAt, uid, a)) return;
      const seat = room.seatOf(uid);
      if (!seat) return;
      const s = S(), t = room.now();
      if (a.type === "answer") {
        const res = answer(s, picks(), seat, Number(a.payload?.i), t);
        if (res.error) { room.setPrivate(uid, "notice", { text: res.error, ts: t }); return; }
        room.setSecret({ ...room.secret, picks: res.picks });
        room.setState(res.state);
        room.sound("place", { volume: 0.6 });
        if (allAnswered(res.state, active)) doReveal(res.state);
      } else if (a.type === "again" && s.phase === "gameOver") {
        room.setState(beginLoading(s, s.settings, t));
      }
    },
    tick(t) {
      if (!room?.state) return;
      const s = S();
      if (s.phase === "loading") { load(s); return; }
      if (s.phase === "question") {
        if (t >= s.timerEndsAt) { doReveal(s); return; }
        tickSound(room, s.timerEndsAt, t, tickMemo);
        updateRing(L.screen, s.timerEndsAt, turnMs(s), t);
        return;
      }
      if (s.phase === "reveal" && t - s.phaseAt > REVEAL_MS) {
        const qs = Q();
        room.setSecret({ ...room.secret, picks: {} });
        const n = next(s, qs, t);
        room.setState(n);
        room.sound(n.phase === "gameOver" ? "win" : "turn");
      }
    },
    render(state) {
      if (!L) return;
      const s = normalizeState(state), T = room.theme, sk = skin(T);
      const head = (banner) => `<header class="bs-top"><div class="bs-title sm">${esc(sk.title)}</div><div class="bs-banner">${esc(banner)}</div>${ringHTML()}</header>`;
      if (s.phase === "setup") {
        const prevKey = document.activeElement?.dataset?.key;
        const row = (key, items, cur) => items.map(([v, label]) => `<button class="btn tq-opt ${String(v) === String(cur) ? "on" : ""}" data-set="${key}" data-v="${v}" data-key="set-${key}-${v}">${esc(label)}</button>`).join("");
        L.screen.innerHTML = `<div class="tq-tv setup">${head("Set up the quiz")}
          <div class="tq-setup">
            <h3>Level</h3><div class="tq-row">${row("level", Object.entries(LEVELS).map(([k, v]) => [k, v.name]), s.settings.level)}</div>
            <h3>Category${s.settings.level === "kids" ? ' <small>(Kids mode keeps every category family-friendly)</small>' : ""}</h3>
            <div class="tq-row wrap">${row("cat", CATEGORIES.filter((c) => !(s.settings.level === "kids" && KID_HIDDEN.has(c.id))).map((c) => [c.id, c.name]), s.settings.cat)}</div>
            <h3>Questions</h3><div class="tq-row">${row("count", COUNTS.map((c) => [c, String(c)]), s.settings.count)}
              <span class="tq-spacer"></span><button class="btn tq-go" data-act="go" data-key="go">Let's play!</button></div>
            <p class="hint">${Object.keys(s.scores).length} player${Object.keys(s.scores).length === 1 ? "" : "s"}: ${Object.keys(s.scores).map((k) => esc(nm(s, k))).join(", ")} · more phones can join any time</p>
          </div>${overControlsHTML(T)}</div>`;
        L.screen.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => {
          const k = b.dataset.set, raw = b.dataset.v;
          const v = k === "count" ? Number(raw) : k === "cat" && raw !== "any" ? Number(raw) : raw;
          const settings = { ...S().settings, [k]: v };
          if (settings.level === "kids" && KID_HIDDEN.has(settings.cat)) settings.cat = "any";
          room.setState({ ...S(), settings });
          room.sound("place");
        }));
        L.screen.querySelector('[data-act="go"]').addEventListener("click", () => { room.setState(beginLoading(S(), {}, room.now())); room.sound("ready"); });
        wireOverControls(L.screen, room, '[data-act="go"]');
        const again = prevKey && L.screen.querySelector(`[data-key="${prevKey}"]`);
        (again || L.screen.querySelector('[data-act="go"]')).focus();
        updateRing(L.screen, null, 1, 0);
        return;
      }
      if (s.phase === "loading") {
        L.screen.innerHTML = `<div class="tq-tv center">${head(LEVELS[s.settings.level].name)}<h2 class="tq-big"><span class="dots">Shuffling the questions</span></h2></div>`;
        updateRing(L.screen, null, 1, 0);
        return;
      }
      if (s.phase === "question" || s.phase === "reveal") {
        const rv = s.phase === "reveal" ? s.reveal : null;
        const who = Object.keys(s.scores);
        L.screen.innerHTML = `<div class="tq-tv">${head(`Question ${s.qn} of ${s.total}`)}
          <div class="tq-meta">${esc(s.q.category)} · ${esc(s.q.difficulty)}</div>
          <h2 class="tq-q">${esc(s.q.text)}</h2>
          <div class="tq-body">${tilesHTML(s, { reveal: rv })}
            ${rv ? boardHTML(s, { gained: true }) : `<ul class="tq-ans">${who.map((k) => `<li class="${s.answered[k] ? "in" : ""}">${s.answered[k] ? "✅" : "⏳"} ${esc(nm(s, k))}</li>`).join("")}</ul>`}</div></div>`;
        updateRing(L.screen, rv ? null : s.timerEndsAt, turnMs(s), room.now());
        return;
      }
      if (s.phase === "gameOver") {
        const r = ranking(s);
        const pod = (k, place) => (k ? `<div class="tq-pod p${place}"><div class="n">${esc(nm(s, k))}</div><div class="sc">${s.scores[k]}</div><div class="st">${place}</div></div>` : "");
        L.screen.innerHTML = `<div class="tq-tv over">
          <h1 class="bs-win">${esc(sk.champ)}: ${esc(nm(s, r[0]))}!</h1>
          <div class="tq-podium">${pod(r[1], 2)}${pod(r[0], 1)}${pod(r[2], 3)}</div>
          ${r.length > 3 ? boardHTML(s, { from: 3 }) : ""}
          <div class="over-ctl"><button class="btn" data-act="again" data-key="again">Play again</button><button class="btn ghost" data-act="setup" data-key="setup">New settings</button></div>
          ${overControlsHTML(T)}
          ${s.source === "opentdb" ? '<p class="hint credit">Questions from the Open Trivia Database (opentdb.com), CC BY-SA 4.0</p>' : ""}</div>`;
        L.screen.querySelector('[data-act="again"]').addEventListener("click", () => room.setState(beginLoading(S(), {}, room.now())));
        L.screen.querySelector('[data-act="setup"]').addEventListener("click", () => room.setState(openSetup(S(), room.seatInfo(), room.now())));
        wireOverControls(L.screen, room, '[data-act="again"]');
      }
    },
  };
  return mod;
}

/* ---------------------------------------------------------------- phone */

export function createPhone() {
  let ctx = null, v = null, prev = null, stopTimer = null, myPick = null, pickQn = null, noticeSeen = 0;
  const seatOf = () => (/^p\d$/.test(v?.me?.role || "") ? v.me.role : null);

  return {
    mount(c) { ctx = c; },
    unmount() { stopTimer?.(); stopTimer = null; },
    render(view) {
      v = view;
      const el = ctx.el, s = normalizeState(view.state), T = view.theme, sk = skin(T), seat = seatOf();
      const inGame = seat && seat in s.scores;
      stopTimer?.();
      if (pickQn !== s.qn || s.phase === "setup" || s.phase === "loading") { if (s.phase !== "reveal") { myPick = null; pickQn = s.qn; } }
      const n = view.priv?.notice;
      if (n && n.ts > noticeSeen) { noticeSeen = n.ts; if (s.phase === "question" && !s.answered[seat]) myPick = null; }
      // feedback
      if (prev && inGame) {
        if (s.phase === "question" && (prev.phase !== "question" || prev.qn !== s.qn)) { ctx.sound("turn"); ctx.vibrate(50); }
        if (s.phase === "reveal" && prev.phase !== "reveal") {
          const g = s.reveal?.gained[seat] || 0;
          ctx.sound(g > 0 ? "win" : "lose");
          if (g > 0) ctx.vibrate([60, 40, 60]);
        }
      }
      prev = { phase: s.phase, qn: s.qn };
      const rank = inGame ? ranking(s).indexOf(seat) + 1 : 0;
      const head = inGame ? `<div class="bj-me"><b>${esc(nm(s, seat))}</b><span>${s.scores[seat]} pts${rank ? ` · #${rank}` : ""}</span></div>` : '<div class="badge">👀 Spectating</div>';

      if (s.phase === "setup" || s.phase === "loading") {
        el.innerHTML = `<div class="pw">${head}<h1>${esc(sk.title)}</h1>
          <p class="sub">${s.phase === "setup" ? "The host is choosing the level and category on the TV…" : "Getting the questions ready…"}</p>
          <p class="sub">Level: <b>${esc(LEVELS[s.settings.level]?.name || "")}</b> · ${s.settings.count} questions</p>${emoteBarHTML(T)}</div>`;
        wireEmotes(el, ctx);
        return;
      }
      if (s.phase === "question") {
        const locked = !!s.answered[seat] || myPick != null;
        el.innerHTML = `<div class="pb tq-p">${head}
          <div class="pb-status"><span class="t">Question ${s.qn} of ${s.total}</span><span class="timer"></span></div>
          <p class="tq-pq">${esc(s.q.text)}</p>
          ${!inGame ? '<p class="sub">You\'ll join in on the next question.</p>' : locked ? `<div class="tq-locked"><h1>Locked in! 🔒</h1>${myPick != null ? `<p class="sub">You picked: <b>${esc(s.q.answers[myPick])}</b></p>` : ""}<p class="sub">Waiting for everyone else…</p></div>` : tilesHTML(s, { tap: true })}
          ${locked || !inGame ? emoteBarHTML(T) : ""}</div>`;
        el.querySelectorAll(".tq-tile[data-i]").forEach((b) => b.addEventListener("click", () => {
          if (myPick != null) return;
          myPick = +b.dataset.i; pickQn = s.qn;
          ctx.sound("place"); ctx.vibrate(30);
          ctx.send("answer", { i: myPick });
          this.render(v);
        }));
        wireEmotes(el, ctx);
        stopTimer = phoneTimer(el, ctx, () => normalizeState(v.state).timerEndsAt);
        return;
      }
      if (s.phase === "reveal") {
        const rv = s.reveal, mine = rv.picks[seat];
        const g = rv.gained[seat] || 0;
        const head2 = !inGame ? "" : mine == null ? sk.none : g > 0 ? sk.right : sk.wrong;
        el.innerHTML = `<div class="po ${g > 0 ? "won" : "lost"}">${head}
          ${inGame ? `<h1 class="big">${esc(head2)}</h1>${g ? `<p class="tq-plus">+${g}</p>` : ""}` : ""}
          <p class="sub">The answer: <b>${esc(s.q.answers[rv.correct])}</b></p>
          ${boardHTML(s, { gained: true, limit: 5 })}${emoteBarHTML(T)}</div>`;
        wireEmotes(el, ctx);
        return;
      }
      if (s.phase === "gameOver") {
        const r = ranking(s);
        el.innerHTML = `<div class="po ${rank === 1 ? "won" : "lost"}">${head}
          <h1 class="big">${rank === 1 ? "YOU WIN! 🏆" : rank ? `You came #${rank}` : `${esc(nm(s, r[0]))} wins`}</h1>
          ${boardHTML(s)}
          ${seat ? '<button class="btn huge" data-act="again">🔁 Play again</button>' : ""}${emoteBarHTML(T)}</div>`;
        el.querySelector('[data-act="again"]')?.addEventListener("click", () => { ctx.send("again"); ctx.sound("ready"); });
        wireEmotes(el, ctx);
      }
    },
  };
}
