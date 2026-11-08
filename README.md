# Battleshits

Jackbox-style party games for the TV. The TV (an onn Google TV stick, or any browser) hosts the game, and every phone is a controller. Phones without a seat spectate and throw emotes onto the screen. Every game has two themes: **Classic Mode** and **Shit Mode**.

| Game | Players | |
|---|---|---|
| 🚢 **Battleshits** | 2 | Battleship: hide your fleet, take turns firing |
| 🔴 **Connect 4** (Connect Plop) | 2 | Drop discs, four in a row wins |
| 🔤 **Hangman** (Flushman) | 2–8 | Take turns setting a word; everyone else guesses |
| ❓ **Trivia** (Brain Dump) | 1–8 | Multiple-choice quiz, with a family-friendly **Kids (10+)** level |
| 🃏 **Blackjack** (Crapjack) | 1–6 | Everyone against the TV dealer |

**Play now**

| | URL |
|---|---|
| 📺 TV | https://phantomdenied.github.io/battleshits/tv.html |
| 📱 Phones | https://phantomdenied.github.io/battleshits/play.html (or scan the QR code on the TV) |
| 🤖 Android TV app | https://github.com/phantomdenied/battleshits/releases/latest/download/battleshits-tv.apk |

## How to play

1. Open the TV page, or the **Battleshits** app on the Google TV home row. The TV shows a room code and a QR code.
2. Each phone scans the QR code (or opens the phone URL and types the code), enters a name, and taps **Join**. The first two phones become Player 1 and Player 2; everyone else spectates.
3. On the TV, use the remote to pick a **game** and a theme, then press **Start**. **Swap** moves people between seats, and **Kick** removes someone.
   During a game, press any button on the remote to bring up **Change game** (press it twice) to go back to the game picker.
**Battleshits**

4. Phones: drag ships onto the grid, tap a ship to rotate it, or tap **Randomize**. Then tap **Ready**.
5. On your turn, tap a square on the enemy grid. A hit gives you another shot. You get 30 seconds per shot; if you're too slow, the TV fires at a random square for you.
6. Sink all five ships to win. Both players tap **Rematch** to play again. The win tally carries over, and the host can switch themes between rounds.

**Battleshits rules:** 10×10 grid with ships of length 5, 4, 3, 3 and 2. Ships can touch but can't overlap or hang off the edge. Player 1 shoots first in round 1, and the first shooter alternates each round. If the shooter's phone disconnects, their timer pauses for up to 60 seconds while they reconnect.

**Connect 4:** tap a column on your phone to drop a disc. 20 seconds per move (the TV drops one for you if you're too slow). The first player alternates each round, and both players tap **Play again** for a rematch.

**Hangman:** everyone sets one word per game, in turn. The setter types a word or phrase (up to 4 words) on their phone, or taps 🎲 **Random**. Everyone else takes turns: tap a letter, or tap **I know it — solve** to guess the whole thing. A correct letter keeps your turn; a wrong letter or wrong solve is a strike and passes the turn; 6 strikes and the setter wins the round. Scoring: +1 per letter revealed, +3 for finishing the word, +2 per hidden letter for a correct solve. The setter gets +1 per wrong guess and +3 if nobody gets it. 25 seconds per turn (running out passes the turn without a strike).

**Trivia:** on the TV, use the remote to pick a **Level** (Kids (10+), Easy, Medium, Hard or Mixed), a **Category** and 10, 15 or 20 questions, then press **Let's play!**. Each question shows on the TV with four colored answers (▲◆●■), or True/False; tap the matching tile on your phone. A right answer scores 500 points plus up to 500 more for speed. After everyone answers (or time runs out) the TV shows the answer, who picked what, and the leaderboard. New phones can join between questions.

* **Kids (10+)** uses 25-second timers, only kid-friendly categories, a built-in bank of 105 hand-written questions, and easy questions from Open Trivia DB filtered for mature topics and franchises. At most half of a Kids quiz comes from Open Trivia DB. The filtering is best-effort, so an odd question can still slip through.
* Questions come from [Open Trivia DB](https://opentdb.com/) (CC BY-SA 4.0; credited on the game-over screen). If it can't be reached, the quiz uses the built-in bank. Questions are in English.

**Blackjack:** everyone starts with 1000 chips. Pick a bet ($10–$500) with the chip buttons and tap **Bet**; the TV deals once everyone has bet, or after 25 seconds. On your turn: **Hit**, **Stand**, **Double** (first two cards) or **Split** (a pair, once). Dealer stands on 17, blackjack pays 3:2, and anyone who goes broke gets a 500-chip bailout. New phones can join between hands. 20 seconds per decision (running out stands).

**Reconnecting:** reloading the phone puts you straight back in your seat. On a different phone or browser, join the same room with the **same name** and you get your seat (and your fleet) back. If the TV reloads, it resumes the same room and the game continues.

## Installing on the onn Google TV stick (sideload)

The APK is a thin full-screen wrapper around the live TV page, with the remote, autoplaying sound and keep-screen-on handled. It shows up on the Google TV home row with its own banner.

**Option A: Downloader app (easiest)**
1. On the TV, install **Downloader** (by AFTVnews) from the Google Play Store.
2. Go to **Settings → System → About** and click **Android TV OS build** 7 times to turn on Developer options.
3. Go to **Settings → Apps → Security & restrictions → Unknown sources** and turn **Downloader** on.
4. Open Downloader and enter this URL:
   `https://github.com/phantomdenied/battleshits/releases/latest/download/battleshits-tv.apk`
5. When the download finishes, choose **Install**, then **Open**. Later it's under **Apps** on the home screen. To pin it to the home row, long-press the app and choose **Move**.

**Option B: Send Files to TV**
1. Install **Send Files to TV** on both the TV and your Android phone.
2. Download the APK on your phone from the link above, send it to the TV, then open it there and install. Allow "unknown sources" for Send Files to TV when prompted.

Updates install over the old version, because every build is signed with the same key.

## Project layout

No build step, no framework, no npm. Plain HTML, CSS and JS modules, with libraries loaded from CDNs (Firebase modular SDK from gstatic, `qrcode-generator` from cdnjs, Google Fonts).

| File | What it does |
|---|---|
| `tv.html` / `tv.css` | TV host and display: lobby, D-pad navigation, runs the authoritative game |
| `play.html` / `play.css` | Phone controller: join, placement, battle, spectator, game over |
| `games.js` | The list of games the TV offers (add a game here) |
| `connect4.js`, `hangman.js`, `trivia.js`, `blackjack.js` | The other game modules, same shape as `battleshits.js` |
| `kit.js` | Shared helpers for game modules: TV layers, emotes, timer ring, between-round controls |
| `games.css` | Styles for Connect 4, Hangman, Trivia and Blackjack |
| `platform.js` | **Game-agnostic** platform: rooms, anonymous auth, presence, seats, reconnect-by-name, action queue, server clock, wake lock, QR, spatial nav |
| `battleshits.js` | The game module: pure rules engine, TV views (`createHost`) and phone views (`createPhone`) |
| `themes.js` | One config block per theme: colors, fonts, ship names, sound recipes, strings, emotes, background |
| `sound.js` | Web Audio synth that plays the theme sound recipes (no audio files) |
| `common.css` | Shared board, ship and theme visuals |
| `database.rules.json` | Realtime Database security rules |
| `dev/harness.html` | Dev-only: plays full games with simulated players on the real TV and phone views, without Firebase |
| `dev/engine.test.mjs` | `node dev/engine.test.mjs`: Battleshits rules tests plus a 300-game simulation |
| `dev/games.test.mjs` | `node dev/games.test.mjs`: rules tests and simulations for Connect 4, Hangman, Trivia and Blackjack (`OFFLINE=1` skips live Open Trivia DB fetches) |
| `android/` | Android TV wrapper (WebView) built by GitHub Actions |

### Architecture

* **The TV is authoritative.** All game logic runs in `tv.html`. Phones only write to `rooms/{CODE}/actions/{uid}`. The TV reads each action, applies it, writes `state`, and clears the action.
* **Fleets are secret.** A phone sends its fleet as a `placeFleet` action. The TV validates it, stores both fleets in `secret/fleets` (only the host can read it), and copies each player's own fleet to `private/{uid}`, which only that player (and the host) can read. `state` never contains ship positions until game over.
* **Firebase layout**
  ```
  roomIndex/{CODE}: createdAt           # lets a new TV find and delete rooms older than 24h
  rooms/{CODE}/
    hostUid, createdAt, game, theme
    state        phase, round, turn, shotLog[], sunk, ready, rematch, tally, winner, reveal, timerEndsAt, seats
    players/{uid}  name, role (p1|p2|spectator), online, lastSeen
    actions/{uid}  { type: placeFleet|fire|emote|rematch, payload, ts }
    secret         fleets{p1,p2}          # host only
    private/{uid}  fleet, notice           # that player + host only
    kicked/{uid}
  ```
* **Module interface.** A game module exports `id`, `initialState()`, `normalizeState()`, `createHost()` and `createPhone()`. The host implements `init(room)`, `canStart()`, `start()`, `onAction(uid, action)`, `tick(now)`, `render(state)`, `onPlayersChanged()` and `onSeatTransfer()`; the phone implements `mount(ctx)`, `render(view)` and `unmount()`. Register it in `games.js` with its seat count (up to 8). `platform.js`, `tv.html` and `play.html` don't change.
* `state.game` says which game a room is playing, so phones switch modules automatically when the host picks another game.

### Adding a theme

Copy one of the blocks in `themes.js`, give it a new key and `id`, and change the values. It shows up in the TV's theme picker automatically.

## Firebase (already set up)

* Project: `battleshits-1108` (Realtime Database in `us-central1`, Anonymous Auth enabled).
* `firebase-config.js` holds the public web config.
* `database.rules.json` is deployed. To redeploy after editing it:
  `npx firebase-tools deploy --only database --project battleshits-1108`
* If you ever need to paste the rules by hand: Firebase console → Realtime Database → **Rules** → paste the contents of `database.rules.json` → **Publish**.

## Development

```bash
node dev/engine.test.mjs                 # Battleshits rules tests + 300 simulated games
node dev/games.test.mjs                  # Connect 4, Hangman, Trivia, Blackjack rules tests + simulations
```
Serve the folder with any static server and open `dev/harness.html` (add `?auto` to start automatically) to watch bots play on the real TV and phone views.

**Versioning:** `VERSION` in `platform.js` is shown in the footer of both pages. Bump it on every meaningful change, and push a matching `vX.Y.Z` tag to build and release a new APK (`.github/workflows/android.yml`).
