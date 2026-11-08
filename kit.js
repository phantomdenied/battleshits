// kit.js — small shared helpers for game modules (TV and phone views).
// Game-agnostic: nothing here knows the rules of any game.
import { THEMES } from "./themes.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Firebase drops empty arrays and may hand arrays back as objects.
export const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null) : v && typeof v === "object" ? Object.keys(v).sort((a, b) => a - b).map((k) => v[k]).filter((x) => x != null) : []);
export const seatList = (n) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
export const seatLabel = (role) => (/^p\d$/.test(role || "") ? `Player ${role.slice(1)}` : "Spectator");
export const pick = (list, rng = Math.random) => list[Math.floor(rng() * list.length)];

/* ------------------------------------------------------------------ TV */

/** Create the standard TV layers inside root: screen, flash text, emote layer. */
export function tvLayers(root) {
  root.innerHTML = '<div class="bs-screen"></div><div class="bs-flash"></div><div class="emote-layer"></div>';
  const screen = root.querySelector(".bs-screen");
  const flashEl = root.querySelector(".bs-flash");
  const emoteEl = root.querySelector(".emote-layer");
  let ft = null;
  return {
    screen,
    flash(text, kind = "") {
      flashEl.className = `bs-flash show ${kind}`;
      flashEl.textContent = text;
      clearTimeout(ft);
      ft = setTimeout(() => { flashEl.className = "bs-flash"; }, 1400);
    },
    shake() { screen.classList.remove("shake"); void screen.offsetWidth; screen.classList.add("shake"); },
    floatEmote(e, name) {
      const d = document.createElement("div");
      d.className = "float-emote";
      d.style.left = `${8 + Math.random() * 84}%`;
      d.innerHTML = `<span class="e">${esc(e)}</span><span class="n">${esc(name)}</span>`;
      emoteEl.appendChild(d);
      setTimeout(() => d.remove(), 4200);
    },
  };
}

/** Rate-limited emote handling shared by every game. Returns true if handled. */
export function handleEmote(room, layers, lastAt, uid, a) {
  if (a.type !== "emote") return false;
  const e = a.payload?.e, t = room.now();
  if (!room.theme.emotes.includes(e)) return true;
  if (t - (lastAt[uid] || 0) < 1500) return true;
  lastAt[uid] = t;
  layers.floatEmote(e, room.players[uid]?.name || "");
  room.sound("emote", { volume: 0.6 });
  return true;
}

export const ringHTML = () => '<div class="bs-ring"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="45"/><circle class="arc" cx="50" cy="50" r="45"/></svg><span class="num"></span></div>';
export function updateRing(root, endsAt, total, now) {
  const ring = root?.querySelector(".bs-ring");
  if (!ring) return;
  if (!endsAt) { ring.style.visibility = "hidden"; return; }
  ring.style.visibility = "";
  const left = Math.max(0, endsAt - now);
  ring.querySelector(".num").textContent = Math.ceil(left / 1000);
  ring.querySelector(".arc").style.strokeDashoffset = String(283 * (1 - Math.max(0, Math.min(1, left / total))));
  ring.classList.toggle("low", left <= 5000);
}
/** Plays a tick on each of the last 5 seconds. Keep `memo` per game. */
export function tickSound(room, endsAt, now, memo) {
  if (!endsAt) { memo.last = null; return; }
  const left = Math.ceil((endsAt - now) / 1000);
  if (left <= 5 && left > 0 && left !== memo.last) { memo.last = left; room.sound("tick"); }
}

/** Theme / Change game / End Room buttons for between-round screens. */
export function overControlsHTML(T, label = "Theme:") {
  const themeBtns = Object.values(THEMES).map((th) => `<button class="btn theme-btn ${th.id === T.id ? "on" : ""}" data-theme="${th.id}" data-key="theme-${th.id}">${esc(th.name)}</button>`).join("");
  return `<div class="over-ctl"><span class="lbl">${esc(label)}</span>${themeBtns}
    <button class="btn ghost" data-act="lobby" data-key="lobby">Change game</button>
    <button class="btn ghost" data-act="end" data-key="end">End Room</button></div>`;
}
export function wireOverControls(screen, room, focusSel = ".theme-btn.on") {
  const prevKey = document.activeElement?.dataset?.key;
  screen.querySelectorAll("[data-theme]").forEach((b) => b.addEventListener("click", () => room.setTheme(b.dataset.theme)));
  screen.querySelector('[data-act="lobby"]')?.addEventListener("click", (e) => room.toLobby(e.currentTarget));
  screen.querySelector('[data-act="end"]')?.addEventListener("click", (e) => room.endRoom(e.currentTarget));
  const again = prevKey && screen.querySelector(`[data-key="${prevKey}"]`);
  (again || screen.querySelector(focusSel))?.focus();
}

/* --------------------------------------------------------------- phone */

export const emoteBarHTML = (T) => `<div class="emote-bar">${T.emotes.map((e) => `<button class="emote" data-e="${e}">${e}</button>`).join("")}</div>`;
export function wireEmotes(el, ctx) {
  el.querySelectorAll(".emote").forEach((b) => b.addEventListener("click", () => {
    if (b.disabled) return;
    ctx.send("emote", { e: b.dataset.e });
    el.querySelectorAll(".emote").forEach((x) => { x.disabled = true; });
    setTimeout(() => el.querySelectorAll(".emote").forEach((x) => { x.disabled = false; }), 1500);
  }));
}
/** Keeps a ".timer" element counting down to endsAt (server time). */
export function phoneTimer(el, ctx, getEndsAt) {
  const upd = () => {
    const t = el.querySelector(".timer");
    const end = getEndsAt();
    if (!t) { clearInterval(id); return; }
    if (!end) { t.textContent = ""; return; }
    const left = Math.max(0, Math.ceil((end - ctx.now()) / 1000));
    t.textContent = `${left}s`;
    t.classList.toggle("low", left <= 5);
  };
  const id = setInterval(upd, 250);
  upd();
  return () => clearInterval(id);
}
