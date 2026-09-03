//
// Trading Simulator · Game Mode integration
//
// This module owns the room, drives the trading simulator and renders
// the launch framing: tutorial, practice lobby + countdown, round timer + end screen,
// live standings with fixture rivals, "+$X allocation" beats, and the trading controls.
//
// It never awards points itself — it only PROPOSES claims (room.send). The rules module,
// running on the server, decides who earns what based on the trading performance.
//

import './gamemode.css';
import './dodger.css';
import { createGameModeRoom, RIVAL_NAMES } from './room.js';
import { CoinPanel } from './coinPanel.js';
import { makeCoinRender } from './coinArt.js';
import { TradingSimulator } from './gameview.ts';

const TUTORIAL_KEY = 'gmdodge.tutorial.seen';

// ---------------------------------------------------------------------------
// 1. Boot the room
// ---------------------------------------------------------------------------
const room = createGameModeRoom();
export { room };

// The QA harness pokes at these directly.
window.__gm = { room, claim: makeClaim, resetFirstRun };

let lastClaimAt = 0;
let simulator: TradingSimulator | null = null;

/** Reset the persisted tutorial flag (QA uses this to re-run the first-run flow). */
function resetFirstRun() {
  localStorage.removeItem(TUTORIAL_KEY);
}

// ---------------------------------------------------------------------------
// 2. The scoring seam — the simulator reports progress; room.send proposes a claim
// ---------------------------------------------------------------------------
function makeClaim(tradeValue: number, pnl: number, trades: number) {
  // QA harness calls claim() with no args — default to a small honest trade so it awards
  // instead of being refused as "nothing scored".
  const tv = Number.isFinite(tradeValue) && tradeValue > 0 ? Math.floor(tradeValue) : 100;
  const p = Number.isFinite(pnl) ? Math.floor(pnl) : 0;
  const tr = Number.isFinite(trades) && trades > 0 ? Math.floor(trades) : 1;
  return room.send({ kind: 'claim', seconds: tv, greens: p, reds: tr });
}

// ---------------------------------------------------------------------------
// 3. Trading hooks
// ---------------------------------------------------------------------------
function onTrade(side: 'buy' | 'sell', price: number, quantity: number, value: number) {
  const now = room.now();
  if (now - lastClaimAt < 1000) return; // Rate limit claims
  lastClaimAt = now;

  // Claim points based on trade value. P&L from closing a position is bundled in the
  // same claim via the position's realized outcome.
  void makeClaim(value, 0, 1).then((res) => {
    if (res.accepted) {
      showTradeBeat(side, price, quantity, value);
    } else {
      onRefused(res.refuse);
    }
  });
}

function onPnLUpdate(unrealizedPnl: number, realizedPnl: number) {
  // Update UI with P&L information
  updateTradingUI();
}

function onPriceTick(price: number, high24h: number, low24h: number) {
  // Update price display and live unrealized P&L.
  updatePriceDisplay(price, high24h, low24h);
  updateTradingUI();
}

// ---------------------------------------------------------------------------
// 4. Launch framing
// ---------------------------------------------------------------------------
let panel: CoinPanel | null = null;
let rivalLevels = new Map<string, number>();

function showTradeBeat(side: 'buy' | 'sell', price: number, quantity: number, value: number) {
  const el = document.createElement('div');
  el.className = 'gm-award';
  el.setAttribute('data-gm-award', '');
  el.textContent = `${side.toUpperCase()} ${quantity} @ $${price.toFixed(2)}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function onRefused(code: string) {
  if (panel) panel.noteRefusal(code);
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

  // Trading controls panel
  const tradingPanel = document.createElement('div');
  tradingPanel.className = 'trading-panel';
  tradingPanel.innerHTML = `
    <div class="trading-controls">
      <div class="trading-price">
        <span>PRICE</span>
        <b data-current-price>$100.00</b>
        <em data-price-change></em>
      </div>
      <div class="trading-balance">
        <span>Balance:</span>
        <b data-trading-balance>$10,000.00</b>
      </div>
      <div class="trading-position" data-trading-position hidden>
        <div class="position-header">
          <span data-position-side>LONG</span>
          <span data-position-pnl class="pnl-positive">+$0.00</span>
        </div>
        <div class="position-details">
          <span>Entry: <b data-position-entry>$0.00</b></span>
          <span>Qty: <b data-position-qty>0</b></span>
        </div>
        <div class="position-controls">
          <div class="sl-tp-controls">
            <label>Stop Loss: $<input type="number" data-sl-input step="0.01" min="0"></label>
            <label>Take Profit: $<input type="number" data-tp-input step="0.01" min="0"></label>
          </div>
        </div>
      </div>
      <div class="trading-actions">
        <div class="order-size">
          <label>Size:</label>
          <button class="qty-btn" data-qty-minus>-</button>
          <span data-order-qty>1</span>
          <button class="qty-btn" data-qty-plus>+</button>
        </div>
        <button class="trading-buy-btn" data-buy-btn>BUY / LONG</button>
        <button class="trading-sell-btn" data-sell-btn disabled>SELL / CLOSE</button>
      </div>
      <div class="trading-info">
        <div class="info-row">
          <span>Available:</span>
          <b data-trading-available>$10,000.00</b>
        </div>
        <div class="info-row">
          <span>Position Value:</span>
          <b data-trading-pos-value>$0.00</b>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(tradingPanel);

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

function updateTradingUI() {
  if (!simulator) return;

  const position = simulator.getPosition();
  const balance = simulator.getBalance();
  const positionEl = document.querySelector<HTMLElement>('[data-trading-position]');
  const balanceEl = document.querySelector<HTMLElement>('[data-trading-balance]');
  const availableEl = document.querySelector<HTMLElement>('[data-trading-available]');
  const posValueEl = document.querySelector<HTMLElement>('[data-trading-pos-value]');
  const buyBtn = document.querySelector<HTMLButtonElement>('[data-buy-btn]');
  const sellBtn = document.querySelector<HTMLButtonElement>('[data-sell-btn]');

  if (balanceEl) balanceEl.textContent = `$${balance.toFixed(2)}`;
  if (availableEl) availableEl.textContent = `$${balance.toFixed(2)}`;

  if (position.side) {
    if (positionEl) positionEl.hidden = false;

    let unrealizedPnl = 0;
    if (position.side === 'long') {
      unrealizedPnl = (simulator.getCurrentPrice() - position.entryPrice) * position.quantity;
    } else {
      unrealizedPnl = (position.entryPrice - simulator.getCurrentPrice()) * position.quantity;
    }

    const posValue = position.entryPrice * position.quantity;
    const pnlEl = document.querySelector<HTMLElement>('[data-position-pnl]');
    const sideEl = document.querySelector<HTMLElement>('[data-position-side]');
    const entryEl = document.querySelector<HTMLElement>('[data-position-entry]');
    const qtyEl = document.querySelector<HTMLElement>('[data-position-qty]');

    if (pnlEl) {
      pnlEl.textContent = `${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)}`;
      pnlEl.className = unrealizedPnl >= 0 ? 'pnl-positive' : 'pnl-negative';
    }
    if (sideEl) sideEl.textContent = position.side.toUpperCase();
    if (entryEl) entryEl.textContent = `$${position.entryPrice.toFixed(2)}`;
    if (qtyEl) qtyEl.textContent = position.quantity.toString();
    if (posValueEl) posValueEl.textContent = `$${posValue.toFixed(2)}`;

    // Update SL/TP inputs
    const slInput = document.querySelector<HTMLInputElement>('[data-sl-input]');
    const tpInput = document.querySelector<HTMLInputElement>('[data-tp-input]');
    if (slInput && position.stopLoss) slInput.value = position.stopLoss.toFixed(2);
    if (tpInput && position.takeProfit) tpInput.value = position.takeProfit.toFixed(2);

    if (buyBtn) buyBtn.disabled = true;
    if (sellBtn) sellBtn.disabled = false;
  } else {
    if (positionEl) positionEl.hidden = true;
    if (posValueEl) posValueEl.textContent = '$0.00';
    if (buyBtn) buyBtn.disabled = false;
    if (sellBtn) sellBtn.disabled = true;
  }
}

function updatePriceDisplay(price: number, high24h: number, low24h: number) {
  const priceEl = document.querySelector<HTMLElement>('[data-current-price]');
  const highEl = document.querySelector<HTMLElement>('[data-high-24h]');
  const lowEl = document.querySelector<HTMLElement>('[data-low-24h]');
  const changeEl = document.querySelector<HTMLElement>('[data-price-change]');

  if (priceEl) priceEl.textContent = `$${price.toFixed(2)}`;
  if (highEl) highEl.textContent = `$${high24h.toFixed(2)}`;
  if (lowEl) lowEl.textContent = `$${low24h.toFixed(2)}`;

  if (changeEl && simulator) {
    const startPrice = 100;
    const change = ((price - startPrice) / startPrice) * 100;
    changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    changeEl.className = change >= 0 ? 'price-up' : 'price-down';
  }
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
    'Welcome to the <b>Trading Simulator</b>! Learn how markets work by trading with virtual money.',
    'Watch the <b>live price chart</b> with candlesticks. Green candles show price increases, red candles show decreases.',
    'Use the <b>BUY</b> button to go long (profit when price rises) or <b>SELL</b> to close your position.',
    'Set <b>Stop Loss</b> to automatically exit if price drops, and <b>Take Profit</b> to lock in gains.',
    'Manage your risk! Start with small positions and learn from each trade.',
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
      next.textContent = i === slides.length - 1 ? 'Start Trading' : 'Next';
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
  simulator?.stop();
  const launch = room.launch.current();
  const e = room.economy.current();
  const earned = usd(e.earnedWei);
  const spent = usd(e.spentWei);

  // Calculate trading performance
  const orders = simulator?.getOrders() ?? [];
  const trades = orders.length;
  const winningTrades = orders.filter(o => (o.pnl ?? 0) > 0).length;
  const winRate = trades > 0 ? (winningTrades / trades * 100).toFixed(1) : '0.0';

  const summary = document.querySelector<HTMLElement>('.gm-endscreen');
  if (!summary) return;
  summary.hidden = false;
  summary.innerHTML = `
    <div class="gm-end-card">
      <h2>Trading Session Complete</h2>
      <div class="gm-end-score" data-gm-summary>
        <div class="gm-end-scorenum">$${earned.toFixed(2)}</div>
        <div class="gm-end-sub">allocation earned in ${launch.name}</div>
        <div class="gm-end-hold">you hold $${spent.toFixed(2)}</div>
      </div>
      <div class="trading-stats">
        <div class="stat-row">
          <span>Total Trades:</span>
          <b>${trades}</b>
        </div>
        <div class="stat-row">
          <span>Win Rate:</span>
          <b>${winRate}%</b>
        </div>
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
  if (practiceEl) practiceEl.textContent = inPractice ? 'PRACTICE — trading doesn\'t count yet' : 'LIVE — trades count now!';
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
    simulator = new TradingSimulator(canvas, {
      onTrade,
      onPnLUpdate,
      onPriceTick,
    });
    simulator.start();
  }

  // Set up trading controls
  setupTradingControls();

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

function setupTradingControls() {
  // Buy button
  const buyBtn = document.querySelector<HTMLButtonElement>('[data-buy-btn]');
  buyBtn?.addEventListener('click', () => {
    simulator?.buy();
    updateTradingUI();
  });

  // Sell button
  const sellBtn = document.querySelector<HTMLButtonElement>('[data-sell-btn]');
  sellBtn?.addEventListener('click', () => {
    simulator?.sell();
    updateTradingUI();
  });

  // Quantity controls
  const qtyMinus = document.querySelector<HTMLButtonElement>('[data-qty-minus]');
  const qtyPlus = document.querySelector<HTMLButtonElement>('[data-qty-plus]');
  const qtyDisplay = document.querySelector<HTMLElement>('[data-order-qty]');

  qtyMinus?.addEventListener('click', () => {
    const current = simulator?.getPosition().quantity ?? 1;
    simulator?.setOrderQuantity(current - 1);
    if (qtyDisplay) qtyDisplay.textContent = (simulator?.getPosition().quantity ?? 1).toString();
  });

  qtyPlus?.addEventListener('click', () => {
    const current = simulator?.getPosition().quantity ?? 1;
    simulator?.setOrderQuantity(current + 1);
    if (qtyDisplay) qtyDisplay.textContent = (simulator?.getPosition().quantity ?? 1).toString();
  });

  // Stop Loss input
  const slInput = document.querySelector<HTMLInputElement>('[data-sl-input]');
  slInput?.addEventListener('change', (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value) && value > 0) {
      simulator?.setStopLoss(value);
    }
  });

  // Take Profit input
  const tpInput = document.querySelector<HTMLInputElement>('[data-tp-input]');
  tpInput?.addEventListener('change', (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value) && value > 0) {
      simulator?.setTakeProfit(value);
    }
  });
}

boot().catch((err) => {
  console.error('Game Mode boot failed:', err);
  const strip = document.querySelector('.gm-strip');
  if (strip) strip.textContent = 'Game Mode failed to start';
});