// themes.js — one config block per theme. The engine and both UIs read only
// from the active theme. To add a theme: copy a block, change the values, and
// add it to THEMES. Nothing else needs to change.
//
// Sound recipes: an array of layers, each played from t seconds after start.
//   { t, type: "sine"|"square"|"sawtooth"|"triangle"|"noise", f:[startHz,endHz],
//     d: seconds, g: peak gain, a: attack seconds, filter:{type, f:[start,end], q} }

const N = { C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2, G4: 392, A4: 440, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784, A5: 880, C6: 1046.5 };

export const THEMES = {
  classic: {
    id: "classic",
    name: "Classic Mode",
    colors: {
      bg: "#06142b", bg2: "#0d2a52", water: "#0f3264", water2: "#0a2347", grid: "rgba(150,190,230,.22)",
      panel: "#27313d", panel2: "#3a4654", text: "#e8eef5", dim: "#9fb2c6", accent: "#e63946", accent2: "#ffd166",
      hit: "#e63946", miss: "#cfe3f5", ship: "#8d99a6", shipEdge: "#c3ccd6", sunk: "#4a2226", focus: "#ffd166",
    },
    fonts: { display: "'Black Ops One', Impact, sans-serif", body: "'Rubik', system-ui, sans-serif" },
    ships: ["Carrier", "Battleship", "Cruiser", "Submarine", "Destroyer"],
    cellArt: { hit: "💥", miss: "●", sunk: "🔥" },
    emotes: ["💥", "🎯", "⚓", "😂", "😤"],
    background: { type: "ocean" },
    strings: {
      title: "Battleshits", tagline: "Naval warfare, phone in hand",
      victory: "VICTORY", defeat: "DEFEAT", defeatPhone: "DEFEAT",
      hit: "HIT!", miss: "MISS", sunk: "SUNK THE {ship}!",
      yourTurn: "YOUR TURN — FIRE!", theirTurn: "{name} is aiming…", tvTurn: "{name}'s turn",
      waters: "{name}'s waters", placeTitle: "Deploy your fleet", placing: "Deploying fleets…",
      wins: "{name} WINS", rematch: "Rematch", auto: "Too slow! Auto-fire",
      waitingReconnect: "Waiting for {name} to reconnect…",
    },
    sounds: {
      miss: [{ type: "noise", d: 0.55, g: 0.45, a: 0.005, filter: { type: "bandpass", f: [1400, 350], q: 1.2 } },
             { type: "sine", f: [700, 180], d: 0.18, g: 0.18 }],
      hit: [{ type: "noise", d: 1.1, g: 0.9, a: 0.004, filter: { type: "lowpass", f: [2200, 90], q: 0.7 } },
            { type: "sine", f: [140, 35], d: 0.7, g: 0.9 },
            { t: 0.05, type: "square", f: [90, 30], d: 0.35, g: 0.15, filter: { type: "lowpass", f: [600, 100] } }],
      sunk: [{ type: "sawtooth", f: [110, 48], d: 2.0, g: 0.22, a: 0.2, filter: { type: "lowpass", f: [700, 200] } },
             { type: "sawtooth", f: [114, 45], d: 2.0, g: 0.18, a: 0.25, filter: { type: "lowpass", f: [600, 180] } },
             { t: 0.3, type: "noise", d: 1.8, g: 0.25, a: 0.4, filter: { type: "lowpass", f: [500, 120] } },
             { t: 1.2, type: "sine", f: [300, 80], d: 0.4, g: 0.1 }],
      win: [{ type: "sawtooth", f: [N.G4, N.G4], d: 0.18, g: 0.2, filter: { type: "lowpass", f: [2400, 2400] } },
            { t: 0.18, type: "sawtooth", f: [N.C5, N.C5], d: 0.18, g: 0.2, filter: { type: "lowpass", f: [2400, 2400] } },
            { t: 0.36, type: "sawtooth", f: [N.E5, N.E5], d: 0.18, g: 0.2, filter: { type: "lowpass", f: [2400, 2400] } },
            { t: 0.56, type: "sawtooth", f: [N.G5, N.G5], d: 1.2, g: 0.22, a: 0.02, filter: { type: "lowpass", f: [2600, 1200] } },
            { t: 0.56, type: "sawtooth", f: [N.C5, N.C5], d: 1.2, g: 0.16, a: 0.02, filter: { type: "lowpass", f: [2400, 1000] } },
            { t: 0.56, type: "sawtooth", f: [N.E5, N.E5], d: 1.2, g: 0.16, a: 0.02, filter: { type: "lowpass", f: [2400, 1000] } }],
      lose: [{ type: "sawtooth", f: [N.G4, N.G4], d: 0.35, g: 0.18, filter: { type: "lowpass", f: [1200, 800] } },
             { t: 0.38, type: "sawtooth", f: [N.E4, N.E4], d: 0.35, g: 0.18, filter: { type: "lowpass", f: [1200, 800] } },
             { t: 0.76, type: "sawtooth", f: [N.C4, 200], d: 1.0, g: 0.2, filter: { type: "lowpass", f: [1000, 400] } }],
      turn: [{ type: "sine", f: [880, 880], d: 0.12, g: 0.18 }, { t: 0.13, type: "sine", f: [1320, 1320], d: 0.18, g: 0.18 }],
      tick: [{ type: "square", f: [1100, 1100], d: 0.03, g: 0.05 }],
      ambience: [{ type: "sine", f: [1480, 1440], d: 2.2, g: 0.07, a: 0.005 }, { t: 0.02, type: "sine", f: [2960, 2900], d: 0.6, g: 0.015 }],
      emote: [{ type: "triangle", f: [660, 990], d: 0.12, g: 0.15 }],
      place: [{ type: "sine", f: [320, 160], d: 0.07, g: 0.2 }],
      error: [{ type: "square", f: [140, 110], d: 0.22, g: 0.12 }],
      ready: [{ type: "sine", f: [523, 523], d: 0.1, g: 0.15 }, { t: 0.1, type: "sine", f: [784, 784], d: 0.16, g: 0.15 }],
    },
    ambienceEvery: 6,
  },

  shit: {
    id: "shit",
    name: "Shit Mode",
    colors: {
      bg: "#1f1408", bg2: "#3b2611", water: "#5b3d1b", water2: "#452e13", grid: "rgba(245,225,170,.18)",
      panel: "#3a2914", panel2: "#4d371b", text: "#f7eed9", dim: "#cdb88f", accent: "#d4a017", accent2: "#ffe28a",
      hit: "#7a3f12", miss: "#bfe3ff", ship: "#6b3e1a", shipEdge: "#a8662c", sunk: "#2a1a0a", focus: "#ffd84d",
    },
    fonts: { display: "'Luckiest Guy', 'Comic Sans MS', sans-serif", body: "'Rubik', system-ui, sans-serif" },
    ships: ["Big Brown", "The Log", "The Floater", "Corn Cob", "The Nugget"],
    cellArt: { hit: "💩", miss: "💦", sunk: "🚽" },
    emotes: ["💩", "🧻", "🪠", "🤢", "😂"],
    background: { type: "sewer", frame: "bowl", border: "tp" },
    strings: {
      title: "Battleshits", tagline: "Who's going down the drain?",
      victory: "VICTORY!", defeat: "FLUSHED", defeatPhone: "YOU GOT FLUSHED",
      hit: "SPLAT!", miss: "PLOP", sunk: "FLUSHED {ship}!",
      yourTurn: "YOUR TURN — DROP ONE!", theirTurn: "{name} is squeezing…", tvTurn: "{name}'s turn",
      waters: "{name}'s bowl", placeTitle: "Hide your logs", placing: "Everyone's getting comfortable…",
      wins: "{name} WINS", rematch: "Another round", auto: "Took too long! Auto-drop",
      waitingReconnect: "Waiting for {name} to get back from the bathroom…",
    },
    sounds: {
      miss: [{ type: "sine", f: [950, 170], d: 0.13, g: 0.55, a: 0.002 },
             { t: 0.02, type: "noise", d: 0.1, g: 0.18, filter: { type: "bandpass", f: [900, 500], q: 2 } }],
      hit: [{ type: "noise", d: 0.38, g: 0.9, a: 0.002, filter: { type: "lowpass", f: [1000, 160], q: 1 } },
            { type: "sine", f: [210, 55], d: 0.28, g: 0.6 },
            { t: 0.04, type: "sawtooth", f: [320, 70], d: 0.22, g: 0.15, filter: { type: "bandpass", f: [600, 250], q: 4 } }],
      sunk: [{ type: "noise", d: 2.4, g: 0.5, a: 0.15, filter: { type: "bandpass", f: [350, 1700], q: 1.6 } },
             { t: 0.4, type: "noise", d: 2.2, g: 0.35, a: 0.3, filter: { type: "lowpass", f: [700, 90], q: 1 } },
             { t: 1.9, type: "sine", f: [500, 220], d: 0.09, g: 0.25 }, { t: 2.05, type: "sine", f: [620, 260], d: 0.08, g: 0.2 },
             { t: 2.2, type: "sine", f: [420, 180], d: 0.1, g: 0.2 }],
      win: [{ type: "square", f: [N.C5, N.C5], d: 0.14, g: 0.12, filter: { type: "lowpass", f: [3000, 3000] } },
            { t: 0.15, type: "square", f: [N.E5, N.E5], d: 0.14, g: 0.12, filter: { type: "lowpass", f: [3000, 3000] } },
            { t: 0.30, type: "square", f: [N.G5, N.G5], d: 0.14, g: 0.12, filter: { type: "lowpass", f: [3000, 3000] } },
            { t: 0.45, type: "square", f: [N.E5, N.E5], d: 0.12, g: 0.12, filter: { type: "lowpass", f: [3000, 3000] } },
            { t: 0.6, type: "square", f: [N.C6, N.C6], d: 1.1, g: 0.14, a: 0.02, filter: { type: "lowpass", f: [3200, 1500] } },
            { t: 0.6, type: "sawtooth", f: [N.G5, N.G5], d: 1.1, g: 0.08, filter: { type: "lowpass", f: [2400, 1200] } },
            { t: 0.6, type: "sawtooth", f: [N.E5, N.E5], d: 1.1, g: 0.08, filter: { type: "lowpass", f: [2400, 1200] } }],
      lose: [{ type: "sawtooth", f: [300, 280], d: 0.4, g: 0.18, filter: { type: "lowpass", f: [900, 700] } },
             { t: 0.45, type: "sawtooth", f: [270, 250], d: 0.4, g: 0.18, filter: { type: "lowpass", f: [900, 700] } },
             { t: 0.9, type: "sawtooth", f: [240, 110], d: 1.3, g: 0.2, filter: { type: "lowpass", f: [900, 300] } },
             { t: 1.4, type: "noise", d: 1.5, g: 0.3, a: 0.2, filter: { type: "bandpass", f: [400, 1400], q: 1.5 } }],
      turn: [{ type: "sine", f: [700, 260], d: 0.1, g: 0.3 }, { t: 0.12, type: "sine", f: [1200, 1400], d: 0.14, g: 0.12 }],
      tick: [{ type: "sine", f: [600, 300], d: 0.05, g: 0.08 }],
      ambience: [{ type: "sine", f: [380, 900], d: 0.08, g: 0.05 }, { t: 0.35, type: "sine", f: [450, 1000], d: 0.07, g: 0.04 }],
      emote: [{ type: "sine", f: [500, 1100], d: 0.1, g: 0.18 }],
      place: [{ type: "sine", f: [600, 200], d: 0.08, g: 0.25 }],
      error: [{ type: "sawtooth", f: [160, 120], d: 0.25, g: 0.12, filter: { type: "lowpass", f: [800, 600] } }],
      ready: [{ type: "sine", f: [700, 260], d: 0.1, g: 0.3 }, { t: 0.12, type: "sine", f: [900, 330], d: 0.1, g: 0.3 }],
    },
    ambienceEvery: 4,
  },
};

export const THEME_IDS = Object.keys(THEMES);
export const getTheme = (id) => THEMES[id] || THEMES.classic;
export const fmt = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

// Apply a theme's colors, fonts and background to a root element (usually <body>).
export function applyTheme(theme, root = document.body) {
  for (const [k, v] of Object.entries(theme.colors)) root.style.setProperty(`--${k}`, v);
  root.style.setProperty("--font-display", theme.fonts.display);
  root.style.setProperty("--font-body", theme.fonts.body);
  root.dataset.theme = theme.id;
  root.dataset.bg = theme.background.type;
  root.dataset.frame = theme.background.frame || "";
  root.dataset.border = theme.background.border || "";
  let layer = root.querySelector(":scope > .bg-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "bg-layer";
    layer.setAttribute("aria-hidden", "true");
    root.prepend(layer);
  }
  if (layer.dataset.for === theme.id) return;
  layer.dataset.for = theme.id;
  layer.innerHTML = "";
  if (theme.background.type === "sewer") {
    for (let i = 0; i < 26; i++) {
      const b = document.createElement("span");
      b.className = "bubble";
      const s = 6 + Math.random() * 26;
      b.style.cssText = `left:${Math.random() * 100}%;width:${s}px;height:${s}px;animation-duration:${7 + Math.random() * 11}s;animation-delay:${-Math.random() * 18}s`;
      layer.appendChild(b);
    }
  } else {
    layer.innerHTML = '<span class="wave w1"></span><span class="wave w2"></span><span class="sonar"></span>';
  }
}
