//
// Minesweeper · Game Mode integration
//
// This module runs alongside the classic-script minesweeper (app.js). It owns the room, hooks the
// game's single scoring seam (every left-click that reveals safe cells) and renders the launch
// framing the port requires: tutorial, practice lobby + countdown, round timer + end screen, live
// standings with fixture rivals, "+$X allocation" beats, in-world coin branding, and the buy card.
//
// It never awards points itself — it only PROPOSES reveals (room.send). The rules module, running
// on the server, decides who earns what based on the safe cells each click opens.

import './gamemode.css';
import { createGameModeRoom, RIVAL_NAMES } from './room.js';
import { CoinPanel } from './coinPanel.js';
import { makeCoinRender } from './coinArt.js';

const TUTORIAL_KEY = 'gmmines.tutorial.seen';
const BOARD_HOST = 'boardBody';

// ---------------------------------------------------------------------------
// 1. Boot the room
// ---------------------------------------------------------------------------
const room = createGameModeRoom();
export { room };

// The QA harness pokes at these directly.
window.__gm = { room, claim, resetFirstRun };

/** Reset the persisted tutorial flag (QA uses this to re-run the first-run flow). */
function resetFirstRun() {
  localStorage.removeItem(TUTORIAL_KEY);
}

// ---------------------------------------------------------------------------
// 2. The scoring seam — the one place minesweeper decides "you revealed cells"
// ---------------------------------------------------------------------------
/** Propose a reveal claim. The QA harness calls this with an explicit cell count. */
function claim(cells?: number) {
  return room.send({ kind: 'reveal', cells: Math.max(1, Math.floor(cells ?? 1)) });
}

/**
 * Hook the game. `__ms_onReveal(cells)` fires once per left-click reveal with how many safe
 * cells that click opened (1 for a numbered cell, a whole region for an empty-cell flood-fill).
 */
function hookScoring() {
  window.__ms_onReveal = async (cells: number) => {
    const res = await room.send({ kind: 'reveal', cells });
    if (res.accepted) {
      onAwarded(cellsToDollars(cells));
    } else {
      onRefused(res.refuse);
    }
  };
}

// ---------------------------------------------------------------------------
// 3. Launch framing
// ---------------------------------------------------------------------------
let panel: CoinPanel | null = null;
let rivalLevels = new Map<string, number>();

function cellsToDollars(cells: number) {
  return Number(cells) * 0.001; // $0.001 per safe cell revealed
}

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
  const host = document.getElementById(BOARD_HOST)?.closest('table')?.parentElement || document.body;
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
    const peak = (i % 4) * 90 + 40;
    const level = Math.round(peak * (0.25 + 0.75 * Math.pow(t, 0.7 + (i % 3) * 0.15)));
    rivalLevels.set(name, level);
  }
}

/** The one standings seam: in-room data + fixture rivals, sorted. (launch-ux.md item 4) */
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
  const banner = document.querySelector('.counter')?.parentElement || document.body;

  // Practice indicator + tip-off countdown above the board.
  const strip = document.createElement('div');
  strip.className = 'gm-strip';
  strip.innerHTML = `
    <div class="gm-practice" data-gm-practice hidden></div>
    <div class="gm-timerbar">
      <span class="gm-tipoff" data-gm-tipoff></span>
    </div>
  `;
  banner.parentElement?.insertBefore(strip, banner);

  // The coin card to the right of the board.
  const wrap = document.body;
  const side = document.createElement('div');
  side.className = 'gm-side';
  wrap.appendChild(side);
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
    'Click a square to reveal it. The number tells you how many mines border it — right-click to <b>flag</b> a mine. Clear every safe square to win.',
    'Every safe cell you reveal scores points in the <b>$MINES</b> launch — each cell is <b>$0.001 of allocation</b>, the right to buy early. A flood-fill that opens a whole empty region pays in one beat.',
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
      next.textContent = i === slides.length - 1 ? 'Start sweeping' : 'Next';
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
  const launch = room.launch.current();
  const e = room.economy.current();
  const earned = usd(e.earnedWei);
  const spent = usd(e.spentWei);
  const summary = document.querySelector<HTMLElement>('.gm-endscreen');
  if (!summary) return;
  summary.hidden = false;
  summary.innerHTML = `
    <div class="gm-end-card">
      <h2>Sweep complete</h2>
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
  if (practiceEl) practiceEl.textContent = inPractice ? 'PRACTICE — reveals don\'t count yet' : 'LIVE — counts now!';
  if (tipoffEl && inPractice) {
    tipoffEl.textContent = `opens in ${minutesLeft(opensAt - now)}`;
  } else if (tipoffEl) {
    tipoffEl.textContent = '';
  }

  tickRivals(now);
  renderStandings();

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

  const launch = room.launch.current();
  const art = launch.imageUrl || makeCoinRender(launch.symbol);
  panel!.setCoin(launch.symbol, launch.name, art);

  // Paint the coin into the world's corner (the board area) and gate it behind a reveal.
  const brand = document.createElement('img');
  brand.className = 'gm-brand';
  brand.src = art;
  brand.alt = launch.name;
  document.getElementById(BOARD_HOST)?.closest('table')?.parentElement?.appendChild(brand);

  room.launch.subscribe((l) => {
    if (l && l.symbol) panel!.setCoin(l.symbol, l.name, l.imageUrl || art);
  });

  hookScoring();

  const drive = () => tick(room.now());
  drive();
  setInterval(drive, 1000);
}

boot().catch((err) => {
  console.error('Game Mode boot failed:', err);
  const strip = document.querySelector('.gm-strip');
  if (strip) strip.textContent = 'Game Mode failed to start';
});
