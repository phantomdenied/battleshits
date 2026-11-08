// sound.js — tiny Web Audio synth that plays the recipes defined in themes.js.
// No audio files. Call unlockAudio() from a user gesture (iOS needs this).
let ctx = null, master = null, noiseBuf = null, muted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function audioReady() { return !!ctx && ctx.state === "running"; }
export function setMuted(m) { muted = m; }

export function unlockAudio() {
  const c = ensure();
  if (!c) return;
  if (c.state !== "running") c.resume().catch(() => {});
  // iOS: play a silent buffer inside the gesture
  const s = c.createBufferSource();
  s.buffer = c.createBuffer(1, 1, 22050);
  s.connect(c.destination);
  s.start(0);
}

// Unlock on the first tap/key anywhere.
export function autoUnlock(onUnlock) {
  const go = () => {
    unlockAudio();
    if (audioReady() || ctx) {
      ["pointerdown", "keydown", "touchend"].forEach((e) => removeEventListener(e, go, true));
      setTimeout(() => onUnlock?.(), 50);
    }
  };
  ["pointerdown", "keydown", "touchend"].forEach((e) => addEventListener(e, go, true));
  // Android TV WebView is created with autoplay allowed; try straight away.
  const c = ensure();
  if (c && c.state !== "running") c.resume().then(() => { if (audioReady()) onUnlock?.(); }).catch(() => {});
}

export function play(recipe, { volume = 1 } = {}) {
  if (muted || !recipe) return;
  const c = ensure();
  if (!c || c.state !== "running") return;
  const t0 = c.currentTime + 0.01;
  for (const L of recipe) {
    const start = t0 + (L.t || 0);
    const dur = L.d || 0.2;
    const g = c.createGain();
    const peak = (L.g ?? 0.3) * volume;
    const atk = Math.min(L.a ?? 0.008, dur / 2);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    let src;
    if (L.type === "noise") {
      src = c.createBufferSource();
      src.buffer = noiseBuf;
    } else {
      src = c.createOscillator();
      src.type = L.type || "sine";
      const [f0, f1] = L.f || [440, 440];
      src.frequency.setValueAtTime(f0, start);
      if (f1 !== f0) src.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), start + dur);
    }
    let node = src;
    if (L.filter) {
      const flt = c.createBiquadFilter();
      flt.type = L.filter.type || "lowpass";
      const [a, b] = L.filter.f || [1000, 1000];
      flt.frequency.setValueAtTime(a, start);
      if (b !== a) flt.frequency.exponentialRampToValueAtTime(Math.max(b, 1), start + dur);
      if (L.filter.q) flt.Q.value = L.filter.q;
      node = node.connect(flt);
    }
    node.connect(g).connect(master);
    src.start(start);
    src.stop(start + dur + 0.05);
  }
}
