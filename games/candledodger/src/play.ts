//
// Candle Dodger · Game Mode integration
//
// This module owns the room, drives the runner engine and renders the launch framing the port
// requires: tutorial, practice lobby + countdown, round timer + end screen, live standings with
// fixture rivals, "+$X allocation" beats, in-world coin branding, and the buy card.
//
// It never awards points itself — it only PROPOSES claims (room.send). The rules module, running
// on the server, decides who earns what based on the survival seconds and green candles reported.

import './gamemode.css';
import './dodger.css';
import { createGameModeRoom, RIVAL_NAMES } from './room.js';
import { CoinPanel } from './coinPanel.js';
import { makeCoinRender } from './coinArt.js';
import { RunnerGame } from './gameview.ts';

const TUTORIAL_KEY = 'gmdodge.tutorial.seen';

// ---------------------------------------------------------------------------
// 1. Boot the room
// ---------------------------------------------------------------------------
const room = createGameModeRoom();
export { room };

// The QA harness pokes at these directly.
window.__gm = { room, claim, resetFirstRun };

let pendingGreens = 0;
let lastClaimAt = 0;
let runner: RunnerGame | null = null;

/** Reset the persisted tutorial flag (QA uses this to re-run the first-run flow). */
function resetFirstRun() {
  localStorage.removeItem(TUTORIAL_KEY);
}

// ---------------------------------------------------------------------------
// 2. The scoring seam — the runner reports progress; room.send proposes a claim
// ---------------------------------------------------------------------------
function makeClaim(seconds: number, greens: number) {
  return room.send({ kind: 'claim', seconds: Math.floor(seconds), greens: Math.floor(greens) });
}

/** Flush any pending greens together with survival progress, then clear the green count. */
async function claim(seconds?: number, greens?: number) {
  const s = Math.max(0, Math.floor(seconds ?? 1));
  const g = Math.max(0, Math.floor(greens ?? pendingGreens));
  pendingGreens = 0;
  previousClaimTime = 0;
  const res = await makeClaim(s, g);
  if (res.accepted) {
    onAwarded(secondsToDollars(s) + greensToDollars(g));
  } else {
    onRefused(res.refuse);
  }
  return res;
}

// ---------------------------------------------------------------------------
// 3. Runner hooks
// ---------------------------------------------------------------------------
const SECOND_DOLLARS = 0.005; // $0.005 per second survived
const GREEN_DOLLARS = 0.02;   // $0.02 per green candle caught

function secondsToDollars(seconds: number) {
  return Number(seconds) * SECOND_DOLLARS;
}
function greensToDollars(greens: number) {
  return Number(greens) * GREEN_DOLLARS;
}

let previousClaimTime = 0;

function estimateSurvivedSeconds(): number {
  const now = room.now();
  if (previousClaimTime === 0) previousClaimTime = now;
  const elapsed = now - previousClaimTime;
  previousClaimTime = now;
  return Math.min(10, Math.floor(elapsed / 1000));
}

function onSurvive(seconds: number) {
  if (pendingGreens > 0) {
    // a green is waiting for its own beat — keep survival for the next clean tick
    return;
  }
  const sec = seconds || estimateSurvivedSeconds();
  if (sec <= 0) return;
  void makeClaim(sec, 0).then((res) => {
    if (res.accepted) onAwarded(secondsToDollars(sec));
    else onRefused(res.refuse);
  });
}

function onGreen() {
  pendingGreens++;
  if (pendingGreens >= 3) flushGreens();
}

function flushGreens() {
  if (pendingGreens <= 0) return;
  const g = pendingGreens;
  pendingGreens = 0;
  void makeClaim(0, g).then((res) => {
    if (res.accepted) onAwarded(greensToDollars(g));
    else onRefused(res.refuse);
  });
}

function onCrash() {
  if (pendingGreens > 0) flushGreens();
  runner?.start();
}

// ---------------------------------------------------------------------------
// 4. Launch framing
// ---------------------------------------------------------------------------
let panel: CoinPanel | null = null;
let rivalLevels = new Map<string, number>();

function onAwarded(wonDollars: number) {
  showAwardBeat(wonDollars);
  if (panel) panel.noteClaim(wonDollars);
  renderStandings();
}

function onRefused(code: string) {
  if (panel) panel.noteRefusal(code);
}

function showAwardBeat(wonDollars: number) {
  const el = document.createElement('div');
  el.className = 'gm-award';
  el.setAttribute('data-gm-award', '');
  el.textContent = `+$${wonDollars.toFixed(2)} allocation`;
  document.body.appendChild(el);
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
    const peak = (i % 4) * 90 + 40;
    const level = Math.round(peak * (0.25 + 0.75 * Math.pow(t, 0.7 + (i % 3) * 0.15)));
    rivalLevels.set(name, level);
  }
}

function buildStandings() {
  const entries = [];
  for (const [name, dollars] of rivalLevels) entries.push({ player: name, dollars, you: false });
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
  const stage = document.querySelector('.dodge-stage');
  if (!stage) return;

  // Practice indicator + tip-off countdown above the board.
  const strip = document.createElement('div');
  strip.className = 'gm-strip';
  strip.innerHTML = `
    <div class="gm-practice" data-gm-practice hidden></div>
    <div class="gm-timerbar">
      <span class="gm-tipoff" data-gm-tipoff></span>
    </div>
  `;
  stage.insertBefore(strip, stage.firstChild);

  // The coin card to the right of the board.
  const side = document.createElement('div');
  side.className = 'gm-side';
  document.body.appendChild(side);
  panel = new CoinPanel(side, room);

  // End screen, hidden until the window closes.
  const end = document.createElement('div');
  end.className = 'gm-endscreen';
  end.setAttribute('data-gm-endscreen', '');
  end.hidden = true;
  document.body.appendChild(end);

  // Score readout top-right.
  room.economy.subscribe(() => {
    const el = document.querySelector<HTMLElement>('[data-dodge-score]');
    const pts = Number(room.economy.current().earnedWei / (room.economy.current().weiPerPoint ?? 10n ** 15n));
    if (el) el.textContent = `${pts} pts`;
  });
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
    'The runner clears a lane of <b>price candles</b>. Steer with <b>▲▼ arrows</b> or by <b>clicking</b> the top or bottom of the lane.',
    'Dodge the <b>red</b> candles (a dip) and catch the <b>green</b> candles (a rally). Every second you survive in a live run scores <b>$0.005 of allocation</b>; each green candle caught scores <b>$0.02</b>.',
    'Hit <b>BUY before the window closes</b> to spend what you earned.',
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
      next.textContent = i === slides.length - 1 ? 'Start dodging' : 'Next';
    }
  });
  body.innerHTML = slides[0];
  overlay.append(body, next);
  document.body.appendChild(overlay);
}

function addReopenButton() {
  const btn = document.createElement('button');
  btn.className = 'gm-reopen';
  btn.textContent = '?';
  btn.addEventListener('click', () => { localStorage.removeItem(TUTORIAL_KEY); location.reload(); });
  document.body.appendChild(btn);
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
  runner?.stop();
  const launch = room.launch.current();
  const e = room.economy.current();
  const earned = usd(e.earnedWei);
  const spent = usd(e.spentWei);
  const summary = document.querySelector<HTMLElement>('.gm-endscreen');
  if (!summary) return;
  summary.hidden = false;
  summary.innerHTML = `
    <div class="gm-end-card">
      <h2>Run complete</h2>
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

  const practiceEl = document.querySelector<HTMLElement>('[data-gm-practice]');
  const tipoffEl = document.querySelector<HTMLElement>('[data-gm-tipoff]');
  const inPractice = now < opensAt;
  if (practiceEl) practiceEl.hidden = !inPractice;
  if (practiceEl) practiceEl.textContent = inPractice ? 'PRACTICE — survival doesn\'t count yet' : 'LIVE — counts now!';
  if (tipoffEl && inPractice) {
    tipoffEl.textContent = `opens in ${minutesLeft(opensAt - now)}`;
  } else if (tipoffEl) {
    tipoffEl.textContent = '';
  }

  tickRivals(now);
  renderStandings();

  if (now >= closesAt && !ended) {
    renderEndScreen();
  }
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

  const canvas = document.getElementById('dodge-canvas') as HTMLCanvasElement | null;
  if (canvas) {
    runner = new RunnerGame(canvas, {
      onSurvive,
      onGreen,
      onCrash,
    });
    runner.start();
  }

  const launch = room.launch.current();
  const art = launch.imageUrl || makeCoinRender(launch.symbol);
  panel!.setCoin(launch.symbol, launch.name, art);

  const brand = document.createElement('img');
  brand.className = 'gm-brand';
  brand.src = art;
  brand.alt = launch.name;
  document.body.appendChild(brand);

  room.launch.subscribe((l) => {
    if (l && l.symbol) panel!.setCoin(l.symbol, l.name, l.imageUrl || art);
  });

  const drive = () => tick(room.now());
  drive();
  setInterval(drive, 1000);
}

boot().catch((err) => {
  console.error('Game Mode boot failed:', err);
  const strip = document.querySelector('.gm-strip');
  if (strip) strip.textContent = 'Game Mode failed to start';
});