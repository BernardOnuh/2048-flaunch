//
// 2048 · Game Mode integration
//
// This module runs alongside the classic-script 2048 game. It owns the room, hooks the game's
// single scoring seam (the per-swipe score delta), and renders the launch framing the port
// requires: tutorial, practice lobby + countdown, round timer + end screen, live standings
// with fixture rivals, "+$X allocation" beats, in-world coin branding, and the buy card.
//
// It never awards points itself — it only PROPOSES claims (room.send). The rules module,
// running on the server, decides who earns what.

import './gamemode.css';
import { createGameModeRoom, RIVAL_NAMES } from './room.js';
import { CoinPanel } from './coinPanel.js';
import { makeCoinRender } from './coinArt.js';

const TUTORIAL_KEY = 'gm2048.tutorial.seen';

// ---------------------------------------------------------------------------
// 1. Boot the room and wait for the classic-script game manager
// ---------------------------------------------------------------------------
const room = createGameModeRoom();
export { room };

// The QA harness pokes at these directly.
window.__gm = { room, claim, resetFirstRun };

/** Reset the persisted tutorial flag (QA uses this to re-run the first-run flow). */
function resetFirstRun() {
  localStorage.removeItem(TUTORIAL_KEY);
}

function waitForManager(timeout = 15_000): Promise<GameManagerShape> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const m = window.__gm_manager;
      if (m) return resolve(m as GameManagerShape);
      if (Date.now() - t0 > timeout) return reject(new Error('game manager did not boot'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
// 2. The scoring seam — the one place 2048 decides "you scored"
// ---------------------------------------------------------------------------
let lastScore = 0;

function claim(batch?: number) {
  // A no-op read helper the QA harness and the game call with an explicit batch. The real
  // hook (hookScoring) diffs the live score. batching >= 1 swipes into one claim event.
  return room.send({ batch: Math.max(1, Math.floor(batch ?? 1)) });
}

/** Assign manager.onMove so each swipe that scored becomes ONE batched claim. */
function hookScoring(manager: GameManagerShape) {
  lastScore = manager.score || 0;
  manager.onMove = async (score: number) => {
    const delta = score - lastScore;
    lastScore = score;
    if (delta <= 0) return; // nothing merged, nothing to claim

    // A swipe may merge several pairs; batch the whole move's points into one claim.
    const res = await room.send({ batch: delta });
    if (res.accepted) {
      onAwarded(batchToDollars(delta));
    } else {
      onRefused(res.refuse);
    }
  };
}

// ---------------------------------------------------------------------------
// 3. Launch framing
// ---------------------------------------------------------------------------
let panel: CoinPanel | null = null;
let rivalLevels = new Map<string, number>(); // name -> dollars

function batchToDollars(points: number) {
  // $0.001 per point (the port's "dollars per scoring event").
  return (Number(points) * 0.001);
}

function dollarsToAlloc(dollars: number) {
  return `$${dollars.toFixed(2)}`;
}

function onAwarded(wonDollars: number) {
  showAwardBeat(wonDollars);
  if (panel) panel.noteClaim(wonDollars);
  renderStandings();
}

function onRefused(code: string) {
  if (panel) panel.noteRefusal(code);
}

/** Surface a "+$X allocation" beat the instant a swipe pays. */
function showAwardBeat(wonDollars: number) {
  const el = document.createElement('div');
  el.className = 'gm-award';
  el.setAttribute('data-gm-award', '');
  el.textContent = `+${dollarsToAlloc(wonDollars)} allocation`;
  const host = document.querySelector('.game-container') || document.body;
  host.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

/** The fixture rivals: named players whose allocations creep up over the round. */
function tickRivals(now: number) {
  const opensAt = room.launch.current().opensAt;
  const closesAt = room.launch.current().closesAt;
  const span = Math.max(1, closesAt - opensAt);
  const t = Math.max(0, Math.min(1, (now - opensAt) / span));
  for (let i = 0; i < RIVAL_NAMES.length; i++) {
    const name = RIVAL_NAMES[i];
    const peak = (i % 4) * 90 + 40; // rivals land between $40 and $310
    const level = Math.round(peak * (0.25 + 0.75 * Math.pow(t, 0.7 + (i % 3) * 0.15)));
    rivalLevels.set(name, level);
  }
}

/** The one standings seam: in-room data + fixture rivals, sorted. (launch-ux.md item 4) */
function buildStandings() {
  const entries = [];
  for (const [name, dollars] of rivalLevels) entries.push({ player: name, dollars, you: false });
  // The player's own line uses earned (available + spent), so a claim shows up immediately.
  const e = room.economy.current();
  if (e.earnedWei > 0n) {
    entries.push({ player: 'you', dollars: usd(e.availableWei + e.spentWei), you: true });
  }
  entries.sort((a, b) => b.dollars - a.dollars);
  return entries;
}

function renderStandings() {
  if (!panel) return;
  panel.renderStandings(buildStandings());
}

// ---------------------------------------------------------------------------
// UI containers
// ---------------------------------------------------------------------------
function buildHUD() {
  const container = document.querySelector('.container') || document.body;

  // Practice indicator + tip-off countdown live above the board.
  const strip = document.createElement('div');
  strip.className = 'gm-strip';
  strip.innerHTML = `
    <div class="gm-practice" data-gm-practice hidden></div>
    <div class="gm-timerbar">
      <span class="gm-tipoff" data-gm-tipoff></span>
    </div>
  `;
  container.prepend(strip);

  // The coin card on the right of the board.
  const side = document.createElement('div');
  side.className = 'gm-side';
  container.appendChild(side);
  panel = new CoinPanel(side, room);

  // End screen, hidden until the window closes.
  const end = document.createElement('div');
  end.className = 'gm-endscreen';
  end.setAttribute('data-gm-endscreen', '');
  end.hidden = true;
  document.body.appendChild(end);
}

// ---------------------------------------------------------------------------
// Tutorial
// ---------------------------------------------------------------------------
function showTutorial() {
  if (localStorage.getItem(TUTORIAL_KEY)) return;
  const overlay = document.createElement('div');
  overlay.className = 'gm-tutorial';
  overlay.setAttribute('data-gm-tutorial', '');
  const slides = [
    'Slide your finger (or arrow keys) to move every tile at once. Identical tiles that touch <b>merge</b> into one — and each merge scores points.',
    'In the <b>$2048</b> launch, every point you score is <b>$0.001 of allocation</b> — the right to buy early, not tokens. Merge to a 2048 tile and your run can be worth up to <b>$75</b>.',
    'Every swipe that merges pays out in one batch. <b>Hit BUY before the window closes</b> to spend what you earned.',
  ];
  let i = 0;
  const body = document.createElement('div');
  body.className = 'gm-tutorial-body';
  const next = document.createElement('button');
  next.className = 'gm-tutorial-next';
  next.setAttribute('data-gm-tutorial-next', '');
  next.textContent = 'Got it';
  next.addEventListener('click', () => {
    i += 1;
    if (i >= slides.length) {
      localStorage.setItem(TUTORIAL_KEY, '1');
      overlay.remove();
    } else {
      body.innerHTML = slides[i].replace(/\n/g, '<br>');
      next.textContent = i === slides.length - 1 ? 'Start playing' : 'Next';
    }
  });
  body.innerHTML = slides[0];
  overlay.append(body, next);
  document.body.appendChild(overlay);
}

// A small reopen button so persistence never hides the rules permanently.
function addReopenButton() {
  const btn = document.createElement('button');
  btn.className = 'gm-reopen';
  btn.textContent = '?';
  btn.addEventListener('click', () => { localStorage.removeItem(TUTORIAL_KEY); location.reload(); });
  (document.querySelector('.heading') || document.body).appendChild(btn);
}

// ---------------------------------------------------------------------------
// Round timer + end screen
// ---------------------------------------------------------------------------
let ended = false;

function minutesLeft(ms: number) {
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderEndScreen() {
  if (ended) return;
  ended = true;
  const launch = room.launch.current();
  const e = room.economy.current();
  const earned = usd(e.earnedWei);
  const spent = usd(e.spentWei);
  const summary = document.querySelector<HTMLElement>('.gm-endscreen');
  if (!summary) return;
  summary.hidden = false;
  summary.innerHTML = `
    <div class="gm-end-card">
      <h2>Round over</h2>
      <div class="gm-end-score" data-gm-summary>
        <div class="gm-end-scorenum">$${earned.toFixed(2)}</div>
        <div class="gm-end-sub">allocation earned in ${launch.name}</div>
        <div class="gm-end-hold">you hold $${spent.toFixed(2)}</div>
      </div>
      <div class="gm-end-lb" data-gm-lb></div>
      <button class="gm-end-buy" data-buy>BUY ${launch.symbol}</button>
    </div>
  `;
  summary.querySelector('[data-buy]')?.addEventListener('click', () => {
    const b = document.querySelector<HTMLButtonElement>('#coin-panel [data-buy]');
    if (b) b.click();
  });
  renderStandingsInto(summary.querySelector<HTMLElement>('[data-gm-lb]'));
}

function renderStandingsInto(target: HTMLElement | null) {
  if (!target) return;
  const entries = buildStandings();
  const top = entries.slice(0, 8);
  const me = entries.find((e) => e.you);
  if (me && !top.some((e) => e.you)) top.push(me);
  target.innerHTML = top
    .map((e, i) =>
      `<div class="cp-row${e.you ? ' you' : ''}"${e.you ? ' data-gm-you' : ''}>` +
      `<span>#${i + 1}</span><b>${e.you ? 'you' : e.player}</b><em>$${e.dollars}</em></div>`)
    .join('');
}

function tick(now: number) {
  const launch = room.launch.current();
  const opensAt = launch.opensAt, closesAt = launch.closesAt;

  // Practice framing
  const practiceEl = document.querySelector<HTMLElement>('[data-gm-practice]');
  const tipoffEl = document.querySelector<HTMLElement>('[data-gm-tipoff]');
  const inPractice = now < opensAt;
  if (practiceEl) practiceEl.hidden = !inPractice;
  if (practiceEl) practiceEl.textContent = inPractice ? 'PRACTICE — scores don\'t count yet' : 'LIVE — counts now!';
  if (tipoffEl && inPractice) {
    tipoffEl.textContent = `opens in ${minutesLeft(opensAt - now)}`;
  } else if (tipoffEl) {
    tipoffEl.textContent = '';
  }

  // Rivals + standings live
  tickRivals(now);
  renderStandings();

  // End screen by closesAt
  if (now >= closesAt && !ended) renderEndScreen();
}

// ---------------------------------------------------------------------------
// Usd helper (reads the round's entitlement rate off the balance)
// ---------------------------------------------------------------------------
function usd(wei: bigint) {
  const e = room.economy.current();
  const rate = e.weiPerPoint ?? 10n ** 15n;
  return Number(wei / rate) * 0.001;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  buildHUD();
  showTutorial();
  addReopenButton();

  // Dress the panel with the launch identity (mock or live).
  const launch = room.launch.current();
  const art = launch.imageUrl || makeCoinRender(launch.symbol);
  panel!.setCoin(launch.symbol, launch.name, art);

  // Paint the coin into the board's corner and the background brand block.
  const brand = document.createElement('img');
  brand.className = 'gm-brand';
  brand.src = art;
  brand.alt = launch.name;
  document.querySelector('.game-container')?.appendChild(brand);

  // Live launch identity can resolve late; re-dress if it does.
  room.launch.subscribe((l) => {
    if (l && l.symbol) panel!.setCoin(l.symbol, l.name, l.imageUrl || art);
  });

  // Hook the scoring seam once the classic game is up.
  const manager = await waitForManager();
  hookScoring(manager);

  // Drive the countdown / standings / end screen from room.now().
  const drive = () => tick(room.now());
  drive();
  setInterval(drive, 1000);

  // Surface the manager for the QA harness to force actions if needed.
  window.__gm_manager_mode = manager;
}

boot().catch((err) => {
  console.error('Game Mode boot failed:', err);
  const strip = document.querySelector('.gm-strip');
  if (strip) strip.textContent = 'Game Mode failed to start';
});
