---
name: port-game-mode
description: Ports an existing open-source browser game into a Flaunch Game Mode with @flayerlabs/gamemode-spec and @flayerlabs/gamemode-client — rules trust boundary, coin metadata/chart/buy surfaces, launch framing (tutorial, practice lobby, round timer + end screen, leaderboard, allocation beats), QA harness, and the uploadable zip. Use when porting, retrofitting or game-mode-enabling a game repo. For building a game from scratch or changing rules in an existing Game Mode, use $build-game-mode instead.
---

# Port an open-source game to a Game Mode

You are turning an existing browser game into a **Game Mode**: a game attached to a token
launch on Flaunch, where playing earns a capped, time-boxed permission to buy the coin.

Written against `@flayerlabs/gamemode-*` **0.2.0**. Install in the target repo:

```bash
npm install @flayerlabs/gamemode-client @flayerlabs/gamemode-spec
npm install --save-dev @flayerlabs/gamemode-cli
```

**Read `references/AGENTS.md` in full before touching anything.** It is the contract; this
skill is the porting procedure on top of it. The two most common porting failures are (a)
trusting the client with points and (b) shipping the SDK surfaces without the *launch
framing* — a port without a tutorial, a practice lobby, a round timer that ends in a score
summary, a leaderboard, and visible points→allocation is not done, no matter how good the
chart looks. `references/launch-ux.md` is that checklist and it is mandatory.

## The gates, in order

Do not proceed past a failed gate. Say plainly why the port stops.

1. **License.** The repo carries an OSI-approved permissive license: MIT, Apache-2.0,
   BSD-2/3-Clause, ISC, Zlib, or Unlicense/CC0. GPL/AGPL/LGPL, "source-available",
   no-license, and any asset pack with unclear rights are all stops. Keep `LICENSE` and
   write/extend `THIRD_PARTY_NOTICES.md` in the port.
2. **Size.** Repo ≤ 50 MB (measure the checkout without `.git` and `node_modules`).
3. **Shape.** Browser-only JS/TS, playable without a server (a dev server for bundling is
   fine; a required game/backend server is a stop until multiplayer support exists). No
   paid APIs, no login walls.
4. **Provenance.** Before any code changes, write `port.json` at the repo root — the
   platform reads this file for attribution and compliance, and a port without it will not
   be accepted:

   ```json
   {
     "name": "<game name>",
     "upstream": {
       "repo": "https://github.com/<owner>/<repo>",
       "author": "<github owner>",
       "commit": "<hash of the commit you ported from>",
       "license": "MIT"
     },
     "portedAt": "<ISO date>",
     "sdk": "<gamemode pack version, e.g. 0.2.0>"
   }
   ```

   Fill `upstream` from the actual origin repo, never from whoever asked for the port.

## The procedure

### 1. Scout

Play the game (`npm/pnpm install && dev`). Then read the code to find:

- **The scoring seam** — the one place the game itself decides "you scored". You will hook
  exactly there, never in input handling or rendering.
- **The shape** — continuous scoring (endless runner, arcade), match-to-target (first to N),
  or turn-based rounds. This picks your rules template and window length.
- **Session length** — how long one honest play session runs. The launch window should fit
  1–2 sessions plus buying time (a 5-minute match → an 8–10 minute window).
- **The stack** — vite / webpack / plain HTML. Prefer keeping the game's own tooling; add
  vite only if there is none.

### 2. Design the economy

The game's physics run in the browser and cannot be trusted, so **the rules bound claims,
they never re-simulate**. Design three numbers and write them down before coding:

- **Dollars per scoring event** — map native scoring to allocation (`pointsPerX` in config;
  the mock's rate is 1 rules point = $1; the client reads `weiPerPoint` off the economy
  balance rather than hardcoding it).
- **The ceiling** — `rewardBounds` derived from the game's *own* caps (a game to 11 capped
  at 15 → 15 × rate). Never invent a cap the game doesn't have; never under-declare.
- **The claim rhythm** — the minimum real time between scoring events in honest play
  (a basketball possession ≈ 4 s; a completed puzzle ≈ 20 s). That becomes the per-action
  cooldown in `decide`. A cheater with a console can claim, but never faster than the game
  can actually be played, never above the ceiling.

Decide immediate vs deferred awards: if the score is public the moment
it lands (a basket, a landed arrow), award immediately; if there is a reveal beat, defer.

### 3. Write the rules module

Start from `templates/rules.ts` (TypeScript even in a JS repo — vite compiles it
transparently). For deeper rules work — deferred awards, phases, server-driven wakes —
follow `$build-game-mode`, which owns rules authoring. Keep it pure; `npx gamemode check src/game/rules.ts` green is a gate.
Refusal codes are stable machine codes (`claim.too_fast`, `claim.cap_reached`,
`game.not_open`, `game.round_over`); player copy lives in the client.

### 4. Wire the room

Start from `templates/room.js`: `createMockRoom` running your real rules, a `replayMarket`
fixture scaled to your window length, and launch metadata. **Everything reads from
`room.launch`** — name, symbol, art — so a live launch drops in with no code change; the
mock's coin is data, not a hardcode. Support the dev URL params the template ships
(`?practice=` and `?round=` in seconds) — the QA harness depends on them.

Hook the scoring seam with a callback the game exposes (e.g. `game.onUserScore = (pts) =>
room.send({ claim: pts })`) so the game module never imports the room.

### 5. Launch framing — the mandatory checklist

Work through `references/launch-ux.md` item by item: tutorial, practice lobby, round timer
+ end screen with score summary, leaderboard (in-round standings + fixture rivals, behind
an adapter-shaped seam), "+$X allocation" beats, in-world coin branding (paint the token
art into the game world where the camera lives — `templates/coinArt.js` is the fallback
render), and buy choreography. Each item has acceptance criteria and a
required `data-gm-*` DOM contract that the QA harness asserts against.

`templates/coinPanel.js` is the coin card (metadata, chart, allocation, BUY, standings)
already speaking that contract. Restyle it to the game's visual language; keep the data
attributes.

### 6. QA

Run `templates/qa.mjs` (copy it into the port as `tools/qa-gamemode.mjs`, set the two
config lines at the top). It boots the game headless and asserts the full loop: tutorial on
first run, practice gating before `opensAt`, a claim awarding, a too-fast claim refusing,
chart pixels, BUY confirming with the hold line, the end screen with summary + leaderboard
at `closesAt`, zero console errors — and saves lobby / mid-round / end-screen screenshots.
**Look at the screenshots.** The harness proves the mechanics; your eyes prove the framing
reads. "It ran" is not evidence; the harness green plus reviewed screenshots is.

Also confirm the held-allowance copy: a nonzero `heldWei` on the economy balance must
render as "reserved until…" from `holdExpiresAt`, never as a silently smaller balance.

### 7. Bundle

- `base: './'` in vite config (the zip host mounts under a content-addressed prefix).
- Zero external requests: bundle all assets; images as data/blob URLs (host CSP is
  `img-src 'self' data: blob:`). No CDN scripts, no web fonts, no analytics.
- Copy `references/AGENTS.md` into the port's root as `AGENTS.md`.
- Build, then `cd dist && zip -qr ../<name>.zip .` — the zip must stay under 20 MB.

## Acceptance

A port is done when all of these hold, and not before:

- [ ] `port.json` present with true upstream provenance; LICENSE + THIRD_PARTY_NOTICES intact
- [ ] `gamemode check` green on the rules module
- [ ] Every item in `references/launch-ux.md` checked, with its `data-gm-*` contract met
- [ ] `qa-gamemode.mjs` green; screenshots reviewed by a human (or reported for review)
- [ ] Held allowance (`heldWei` + `holdExpiresAt`) renders as reserved, not vanished
- [ ] Zip built from relative base, ≤ 20 MB, zero external requests

If the game genuinely cannot satisfy the interface (needs a server, has no bounded scoring
rhythm, can't run headless), stop and say so explicitly — a clear "not portable because X"
is worth more than a hacked port.
