# Porting patterns

Recipes distilled from the first two ports: **sunken-gold** (greenfield, deferred-reveal
economy, full framing) and **vibebasketball** (retrofit of an existing OSS game,
claims-based economy). The recipes below stand alone; those codebases are the extended
reference where you have access to them.

## Hooking the scoring seam

Never make the game module import the room. Give the game a callback and glue in the entry
point:

```js
// in the game's scoring function (game.js) — one line at the seam:
if (!this.attract && scorer === this.userPlayer) this.onUserScore?.(points);

// in main.js:
game.onUserScore = (points) => {
  void room.send({ claim: points }).then((r) => {
    if (r.accepted) framing.awardBeat(points);       // "+$X ALLOCATION"
    else framing.refusalBeat(r.refuse);              // player copy, below
  });
};
```

Guard the seam against non-player scoring: AI opponents, attract/demo modes, replays.

## Choosing the rules shape

| Game shape | Award timing | Template notes |
|---|---|---|
| Match-to-target (1v1 to 11, first-to-N) | Immediate (score is public when it lands) | `templates/rules.ts` as-is; ceiling = the match cap |
| Continuous/arcade (runner, shooter) | Immediate | Same template; ceiling = best honest run in one window; claim = a scoring event, not a frame |
| Hidden-information / reveal (cards, mining, quiz) | **Deferred** — accept now, award at the reveal | Split accept and award: the accept event carries no outcome, the reveal event carries `awards`. See sunken-gold's scoop→filter pair |

Claim-bounding heuristics: cooldown = the minimum *honest* seconds between scoring events,
measured by playing, then rounded down a little (punishing good players is worse than
leaking a few dollars to a script). Per-round ceiling = the game's own cap, never an
invented one. Oversized/malformed input dies in `parseAction`.

## Refusal copy map

Codes are stable; copy is free. Keep one map in the client:

```js
const REFUSAL_COPY = {
  'game.not_open':     'practice — counts after tip-off',
  'game.round_over':   'the launch window has closed',
  'claim.too_fast':    'scored too fast — not counted',
  'claim.cap_reached': 'allocation ceiling reached — spend it!',
  'action.malformed':  'that made no sense',
};
```

Never surface a threshold a cheater could calibrate against.

## Market fixture

Scale the replay to the window: a price point every ~5 s across the whole `roundMs`, a
quiet open, one spike around 30–45 % in, a late rally. Trades come from **named fixture
rivals** (see below) so the chart dots and the feed share a cast. Pattern in
`templates/room.js`.

## Fixture rivals (the leaderboard cast)

A solo room must still feel like a race. Give the launch 4–8 named rivals; their scores
tick up on a timer during play, land in the feed ("DIMES banked $30"), populate the live
standings panel, and fill the end-screen leaderboard around the player's real score:

```js
const rivals = new Map(RIVAL_NAMES.map((n) => [n, 0]));
// every 15–40s during live play:
rivals.set(name, rivals.get(name) + typicalScore);
framing.renderStandings(standingsFrom(rivals, you)); // ONE seam — a real cross-room
                                                     // feed replaces standingsFrom later
```

Keep `renderStandings(entries)` as the single entry point: `entries` is
`[{ player, dollars, you? }]` sorted best-first. When the platform ships a cross-room
standings surface, it feeds the same function.

## In-world branding

The token art goes where the camera dwells. If the game paints its world onto canvas
textures (most procedural games do), expose a `brand(imageSrc)` on the texture builder that
repaints in place and sets `needsUpdate` — draw a base coat, the image clipped to shape at
paint alpha (~0.85), then re-apply the texture's own wear pass so it reads as painted-on,
not a decal. If the world is DOM/sprites, brand a background layer or a billboard sprite.
Always route through the fallback:

```js
const art = launch.imageUrl ?? makeCoinRender(launch.symbol); // templates/coinArt.js
```

`imageUrl` is a data/blob URL on live launches (host CSP: `img-src 'self' data: blob:`);
load via `Image` with an `onerror` that keeps the fallback.

## Practice lobby

Set `opensAt` in the future and let the game run normally before it — just framed:

```js
const inPractice = () => room.now() < room.launch.current().opensAt;
// scoring seam: still send the claim; the rules refuse 'game.not_open' and the
// framing shows PRACTICE copy instead of a raw refusal:
if (inPractice()) framing.practiceBeat();   // "practice bucket — counts after tip-off"
```

Do not fork the game logic for practice — the refusal *is* the gate; practice is copy and a
countdown (`data-gm-practice`, `data-gm-tipoff`). Announce the open ("TIP-OFF — it counts
now") once, from a `room.now()` check in the frame loop, never `Date.now()`.

## Round timer + end screen

All countdowns derive from `room.now()` and the launch's absolute times. End screen fires
once, at natural game end or `closesAt`, whichever first — but always by `closesAt`:

```js
if (!endShown && (gameOver || room.now() >= launch.closesAt)) {
  endShown = true;
  framing.showEnd({ score, dollars, standings, booksCloseAt: launch.booksCloseAt });
}
```

The end screen's BUY is the port's most important button: allocation earned, leaderboard
rank, "window closes in mm:ss", BUY. A shareable score-card canvas is a good optional extra.

## Tutorial cards

2–4 cards, screenshots or in-engine renders, persisted key like `<game>.firstrun`. The
economy card uses the launch's real ticker from `room.launch` — never hardcode.

## Dev/QA hooks

The QA harness (and any agent verifying the port) needs deterministic reach into the game.
Expose on `window`:

```js
window.__gm = {
  room,                       // the Room instance
  claim: (pts = minClaim) => game.onUserScore?.(pts),  // propose a scoring event
  resetFirstRun: () => localStorage.removeItem(FIRSTRUN_KEY),
};
```

And support URL params: `?practice=SECONDS` (practice window length) and `?round=SECONDS`
(window length) — mock-only, so short rounds and instant tip-offs are reachable in tests.

## Zip/CSP gotchas

- `base: './'` or every asset 404s on the host's content-addressed prefix.
- No external requests at all — bundle fonts, inline audio, no CDNs, no analytics.
- Swallow browser zoom gestures (ctrl+wheel, Safari gesture events) if the HUD is zoom-sensitive.
- Audio: unlock on first gesture, suspend on `visibilitychange` (autoplay policy).
