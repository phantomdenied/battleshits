# Battleshits v0.1.0 — Plan

Party Battleship for an onn Google TV stick. Phones are the controllers. This is also the first module of a reusable party-game platform.

## 0. Audit (done 2026-11-08)

| Check | Result |
|---|---|
| `gh` auth | ✅ logged in as **phantomdenied**, scopes `repo, workflow, gist, read:org`: enough to create the repo, push, enable Pages, set Actions secrets and make releases |
| `phantomdenied/battleshits` | Doesn't exist yet. I'll create it (public) once you approve this plan |
| `firebase` CLI | ❌ not installed, not logged in. That's why I need your web config (see §9) |
| git / node | git 2.55, node 24 (node is only used to run engine tests locally; there's no npm and no build step) |
| Local Android SDK | Not needed. The APK is built by GitHub Actions |

Live URLs once deployed:
- TV: `https://phantomdenied.github.io/battleshits/tv.html`
- Phone: `https://phantomdenied.github.io/battleshits/play.html?room=CODE`
- APK: `https://github.com/phantomdenied/battleshits/releases/latest/download/battleshits-tv.apk`

## 1. File list

```
/
├── index.html              tiny landing page: "TV → tv.html / Phone → play.html", plus code entry
├── tv.html                 host + display (lobby, battle, game over); runs the game engine
├── play.html               phone controller (join, placement, battle, spectator, game over)
├── platform.js             GAME-AGNOSTIC: firebase init, auth, rooms, presence, roles,
│                           action queue, server-clock offset, wake lock, audio unlock,
│                           TV D-pad spatial nav, VERSION constant
├── themes.js               theme configs: classic, shit (one block each)
├── sound.js                Web Audio synth: plays "recipes" defined in themes.js
├── battleshits.js          game module: pure rules engine + platform interface
│                           (init / onAction / render) + TV and phone renderers
├── firebase-config.js      your web config (public by design; it's not a secret)
├── database.rules.json     RTDB security rules
├── dev/harness.html        dev-only: plays full games with simulated actions, no Firebase
├── dev/engine.test.mjs     `node dev/engine.test.mjs`: rules unit tests (no npm)
├── .nojekyll
├── README.md               setup, rules paste-in, sideloading, how to add a game/theme
├── PLAN.md
├── android/                minimal Gradle project (Java, one Activity, WebView)
│   ├── settings.gradle, build.gradle, gradle.properties
│   └── app/
│       ├── build.gradle
│       └── src/main/
│           ├── AndroidManifest.xml      LEANBACK_LAUNCHER intent, banner, touchscreen not required
│           ├── java/.../MainActivity.java
│           └── res/drawable/banner.xml, res/drawable/icon.xml  (vector drawables, no PNGs)
└── .github/workflows/android.yml   builds the APK on tag push → GitHub Release asset
```

CDN dependencies (pinned exact versions, checked at implementation time):
- Firebase modular SDK from `www.gstatic.com/firebasejs/<ver>/` (app, auth, database)
- `qrcode-generator` (kazuhikoarase) from cdnjs for the lobby QR (rendered as SVG)

## 2. Firebase data model

```
roomIndex/{CODE}: createdAt              // authed read; lets the TV find and delete stale rooms
rooms/{CODE}/
  hostUid            string
  createdAt          serverTimestamp
  game               "battleshits"        // platform hook for future games
  theme              "classic" | "shit"
  state/
    phase            "lobby" | "placement" | "battle" | "gameOver"
    round            int (1, 2, …)
    turn             "p1" | "p2"
    timerEndsAt      ms (server-clock based) | null
    timerPausedLeft  ms | null            // set while the shooter is disconnected
    shotLog[]        { by: "p1"|"p2", r, c, result: "miss"|"hit"|"sunk", ship?: idx, auto?: bool, ts }
    sunk             { p1: [shipIdx…], p2: [shipIdx…] }   // ships OF that player that are sunk
    ready            { p1: bool, p2: bool }               // placement done
    rematch          { p1: bool, p2: bool }
    tally            { p1: int, p2: int }                 // session wins, keyed by seat
    winner           "p1" | "p2" | null
    reveal           { p1: fleet, p2: fleet } | null      // only written at gameOver
    emotes           { pushId: { by: name, e: "💩", ts } } // last ~10, TV prunes
    seats            { p1: { uid, name } | null, p2: … }  // denormalised for phone UIs
  players/{uid}      { name, role: "p1"|"p2"|"spectator", ready, lastSeen, online }
  actions/{uid}      { type: "placeFleet"|"fire"|"emote"|"rematch", payload, ts }
  secret/
    fleets           { p1: fleet, p2: fleet }   // host-only
  private/{uid}/
    fleet            fleet                      // host-written copy of THAT player's own fleet
```

`fleet` = `[{ len, r, c, dir: "h"|"v" }] × 5`, in fleet order 5,4,3,3,2.

**One addition to your layout: `private/{uid}`.** It's needed because a phone that reloads or rejoins on a new device still has to draw its own fleet and incoming damage, and phones can never read `secret`. The host writes each player's own fleet there, and the rules let only that uid (and the host) read it. The opponent still can't read it.

## 3. Security rules (summary; exact JSON goes in `database.rules.json`)

- `roomIndex/$code`: read by any authed user; write only when creating a new entry, or deleting one older than 24h, or by that room's host.
- `rooms/$code`:
  - create: allowed only when the room doesn't exist and `newData.hostUid == auth.uid`
  - delete: by `hostUid`, **or by any authed user when `createdAt < now − 24h`** (that's how a TV cleans up stale rooms it doesn't own)
  - `hostUid`, `createdAt`, `game`: write-once
  - `state`, `theme`: read by any authed user, write only by `hostUid`
  - `players/$uid`: read by any authed user; write by `$uid` or host. A non-host can't change `role`, so phones can't self-promote. They can only create themselves as `spectator` with `ready=false`, and the host assigns seats
  - `actions/$uid`: read/write by `$uid` or host; validated `type` enum; payload size-capped
  - `secret`: read/write **only** by `hostUid`
  - `private/$uid`: read by `$uid` or host; write by host only
- There is no read rule at `rooms/$code` itself, so nobody can read the whole room (that would leak `secret`). Clients subscribe to the individual child paths.

## 4. Platform layer (`platform.js`, no Battleship knowledge)

- `createRoom({ game, theme })` (TV): anonymous sign-in, sweep `roomIndex` for entries older than 24h and delete those rooms, pick a 4-letter code from `ABCDEFGHJKLMNPQRSTUVWXYZ` (no I/O/0/1), reserve it with a transaction on `roomIndex/{CODE}`, write the room.
- **Host persistence**: the TV keeps `{code, hostUid}` in localStorage and the anonymous uid persists in the WebView. A TV reload resumes the same room instead of making a new one. "End Room" clears this.
- `joinRoom(code, name)` (phone): anonymous sign-in, then write `players/{uid}`. The name is remembered in localStorage.
- **Presence**: `.info/connected` sets `online: true`; `onDisconnect` sets `online: false` and `lastSeen: serverTimestamp`; a 15-second `lastSeen` heartbeat runs while the page is visible.
- **Seat assignment** (TV): the first two joiners get p1/p2 and the rest are spectators.
- **Reconnect by name** (TV): if a new uid joins with the same name (case-insensitive) as an existing player who is offline, the new uid inherits that role, the old entry is deleted, `private/{old}` moves to `private/{new}`, and `state.seats` is updated. If the matching player is still *online*, the name gets a suffix ("Sam 2") so nobody steals a live seat.
- **Host controls**: Start, Kick (deletes `players/{uid}`; the phone shows "Removed by host" and doesn't auto-rejoin), Swap (cycle p1 ↔ p2 ↔ promote a spectator), End Room (deletes the room, which sends every phone back to the join screen).
- **Actions**: the TV listens on `actions` (`child_added`/`child_changed`), calls `module.onAction(uid, action, player)`, then removes the action. Phones write with `set()`, so one pending action is allowed per phone (fine for this game).
- **Server clock**: `.info/serverTimeOffset` on both sides, so phone countdowns match the TV.
- **Module interface**:
  ```js
  export default {
    id: "battleshits", minPlayers: 2, maxSeats: 2,
    init(room)                // room = { code, db helpers, setState, setSecret, setPrivate, players, theme }
    onAction(uid, action)     // TV only, authoritative
    onPlayersChanged(players) // TV: seat changes, disconnects (pause timer)
    render(state, ctx)        // TV render; renderPhone(state, ctx) for phones
  }
  ```
- Utilities: Wake Lock (re-acquired on `visibilitychange`), audio unlock on first tap or keypress, double-tap zoom off (`touch-action: manipulation`, viewport `user-scalable=no`, gesture events blocked on iOS), and **TV spatial navigation**: arrow keys move focus to the nearest focusable element in that direction, Enter activates, with a big visible focus ring.

## 5. Game rules (locked, plus four small decisions marked ⚑)

- 1v1 on a 10×10 grid. Fleet 5,4,3,3,2. Ships may touch, may not overlap, must be in bounds. The TV re-validates every fleet and rejects bad ones with an error back to that phone.
- One shot per turn. **A hit or a sink grants another shot.** A miss passes the turn.
- 30-second turn timer, **reset after every shot** (including the bonus shot after a hit). On expiry the TV fires at a random unshot cell for that player (marked `auto`). The hit-again rule applies to auto shots too.
- Firing at an already-shot cell is rejected. Phones grey those cells out anyway.
- A ship is sunk when all its cells are hit. You win when all 5 enemy ships are sunk.
- ⚑ **Who shoots first**: p1 in round 1, then the starting seat alternates each round.
- ⚑ **Disconnect during battle**: if the player whose turn it is goes offline, the timer pauses (`timerPausedLeft`) and resumes when they reconnect, so a dropped phone doesn't get auto-played to a loss. The TV shows "Waiting for NAME to reconnect…".
- ⚑ **Placement has no timer.** Battle starts when both seats are ready.
- ⚑ **Emotes** come from spectators *and* players, rate-limited to 1 per 1.5 s per uid on the TV.
- Phases: `lobby → placement → battle → gameOver → (both tap rematch) → placement`. During gameOver the host can change the theme on the TV, and the new theme applies to the next round. The tally persists for the life of the room.

## 6. Themes (`themes.js`)

Each theme is one config object. The engine and UI read only from the active theme:
```js
{ id, name, colors{bg, water, grid, hit, miss, accent, text, panel}, fonts{display, body} (Google Fonts),
  ships[5] (names, fleet order), sounds{ miss, hit, sunk, win, lose, turn, tick, ambience, emote } (synth recipes),
  strings{ title:"Battleshits", victory, defeatPhone, yourTurn, theirTurn, hit, miss, sunk(name), … },
  emotes[5], background{ type, … } (CSS/SVG generator), cellArt{ hit, miss } (emoji/SVG) }
```
- **Classic**: navy ocean with an animated subtle wave gradient, steel grey and red UI, sonar ping ambience (sine sweep with a long tail, every ~6 s). Miss = splash (filtered noise burst). Hit = explosion (low noise, pitch-dropping thump). Sunk = sinking groan (detuned saws gliding down). Win = "VICTORY" plus a brass-ish chord. Emotes 💥 🎯 ⚓ 😂 😤.
- **Shit**: murky brown water with CSS bubbles rising, the grid framed as a toilet bowl (SVG), toilet-paper borders (CSS repeating gradient with perforations), gold accents. Ships Big Brown, The Log, The Floater, Corn Cob, The Nugget. Miss = plop (sine with quick pitch drop). Hit = 💩 splat (noise and squelch). Sunk = flush (long filtered-noise swirl). Win = fanfare; the losing phone shows **"YOU GOT FLUSHED"**. Emotes 💩 🧻 🪠 🤢 😂.
- Adding a theme = adding one block to `themes.js` (the README shows how).

## 7. Screens

**TV (1920×1080, 5% safe margins, couch-readable type ≥ 32px for body text)**
- *Lobby*: huge room code, QR (links to `play.html?room=CODE`), short phone URL as text, player list (name, seat, online dot) with Swap/Kick buttons per row, theme toggle with a live preview, Start (enabled once p1 and p2 are filled), End Room. All controls work with the D-pad. A "Press OK for sound" hint appears until audio is unlocked (the APK autoplays anyway).
- *Placement*: "Placing fleets…" with a ready tick per player.
- *Battle*: two shot grids side by side (hits and misses only, never ship positions), a turn banner with a countdown ring, hit/miss/sunk animations and sounds, a sunk-ship tracker under each grid (ship names crossed out), and emotes floating up from the bottom.
- *Game over*: the winner, both fleets revealed with hits overlaid, the session tally, rematch status per player ("Waiting for Sam…"), theme toggle, End Room.

**Phone (player)**: Join (code prefilled from `?room=`, name, Join) → Waiting in lobby (your seat) → Placement (drag ships from a tray onto the grid with pointer events, tap a placed ship to rotate, live red/green validation while dragging, Randomize, Ready) → Battle (big enemy grid you tap to fire, disabled with "Their turn" when it isn't your turn; a small own-fleet grid showing incoming hits; countdown; emote bar) → Game over (win, or "YOU GOT FLUSHED" / "DEFEAT"; Rematch button).

**Phone (spectator)**: score and turn display, both grids small (shots only), emote bar.

**Version footer** on both pages: `Battleshits v0.1.0` from `VERSION` in `platform.js`. I'll bump the patch version for fixes and the minor version for features as I go, and keep the APK `versionName` in sync.

## 8. Android wrapper (`/android`)

- One `MainActivity` (Java, no AndroidX needed): a full-screen immersive `WebView` loading the live `tv.html`, with `javaScriptEnabled`, `domStorageEnabled`, `mediaPlaybackRequiresUserGesture = false`, `FLAG_KEEP_SCREEN_ON`, D-pad passed through, and Back asking to confirm exit. It shows an offline retry screen if the page fails to load.
- Manifest: the `LEANBACK_LAUNCHER` and `LAUNCHER` intents, `android:banner` (320×180 vector drawable with the Battleshits title), `touchscreen required=false`, `leanback required=false`, `INTERNET` permission. minSdk 26, targetSdk 34.
- **CI**: `.github/workflows/android.yml` installs JDK 17 and Gradle via `gradle/actions/setup-gradle` and runs `assembleDebug`. On a `v*` tag it attaches `battleshits-tv.apk` to a GitHub Release. **Stable signing**: I'll generate one debug keystore and store it as an Actions secret with `gh secret set`, so every build has the same signature and later APKs install as updates, not "app not installed".
- README: sideloading on the onn stick (Developer options → enable "Install unknown apps" for Downloader → enter the APK URL; or the "Send Files to TV" app).

## 9. What I need from you (Firebase)

There's no Firebase CLI here, so choose one:

**A. Console, about 3 minutes (simplest)**
1. Go to console.firebase.google.com → Add project "battleshits" (Analytics off).
2. Build → Authentication → Get started → enable **Anonymous**.
3. Build → Realtime Database → Create database (any location, start in **locked mode**).
4. Project settings → Your apps → Web (`</>`) → register "battleshits" → **paste the `firebaseConfig` object to me**.
5. After I write `database.rules.json`, paste it into Realtime Database → Rules → Publish. I'll give you the exact text, and that's the only console step after this.

**B. I do it via CLI**: I run `npx firebase-tools login` in a terminal tab, you finish the Google sign-in in your browser, then I create the project, web app, database and rules and enable Anonymous auth. This takes longer and uses more steps that can fail, but there's nothing to paste.

## 10. Milestones (one commit each, version bumped)

1. **Platform + lobby**: repo scaffold, `firebase-config.js`, `platform.js`, rules, TV lobby (code, QR, players, roles, swap/kick, theme toggle, D-pad nav), phone join and waiting screen, presence. Pages enabled early so I can test on real URLs.
2. **Engine + harness**: pure rules engine in `battleshits.js`, `dev/engine.test.mjs`, and `dev/harness.html` auto-playing full games with simulated actions (placement, hits/bonus shots, timeouts, sinks, win, rematch).
3. **Phone placement**: drag/rotate/randomize/validate/Ready, plus TV validation into `secret` and `private`.
4. **Battle loop**: firing, hit-again, 30-second timer with auto-fire, disconnect pause, live TV and phone grids, game over with reveal.
5. **Themes**: `themes.js` and `sound.js`, both themes' visuals, sounds, animations and emotes.
6. **Rematch, tally, reconnect-by-name, TV reload recovery** (rebuild from `state` + `secret` + localStorage host record).
7. **Android APK**: Gradle project, workflow, keystore secret, tag `v0.x.0`, release asset.
8. **Push live and verify**: Pages on main/root via `gh api`, confirm `tv.html`, `play.html` and the APK link return 200, and run a full game with headless browser tabs (one TV and three phones) against the live Firebase. Final message: TV URL, phone URL, APK link, version, known issues.

## 11. Known risks / notes

- iOS Safari supports Wake Lock only on 16.4+. Older versions just don't keep the screen awake.
- The web TV page (not the APK) needs one remote keypress before sound plays (browser autoplay policy). The APK doesn't have this limit.
- Anonymous auth uids are per browser. Clearing site data or switching browsers gives a new uid, which is exactly what reconnect-by-name handles.
- Stale-room cleanup only runs when a TV creates a room (as specified). There's no server-side cron.
