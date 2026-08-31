/**
 * Player copy for the rules' stable refusal codes. Codes never change; this text can.
 * TODO: reword to the game's voice, keep the keys.
 */
const REFUSAL_COPY = {
  'game.round_over': 'the launch window has closed — no more allocation',
  'game.not_open': 'practice — counts after the round opens',
  'game.not_playing': 'you are not in this launch',
  'claim.too_fast': 'scored too fast — not counted',
  'claim.too_big': 'that made no sense',
  'claim.cap_reached': 'allocation ceiling reached — spend it!',
  'action.malformed': 'that made no sense',
};

/** Deterministic dot colour per trader, so the chart and the feed agree on who is who. */
function traderColor(player) {
  if (!player) return '#8a93a6';
  let h = 0;
  for (let i = 0; i < player.length; i++) h = (h * 31 + player.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 62% 62%)`;
}

/**
 * The coin card: launch identity, live market chart, live standings, allocation and BUY.
 * Every number derives from the room's launch/market/economy surfaces — nothing here keeps
 * game state. Restyle freely; KEEP the data attributes — the QA harness asserts them.
 */
export class CoinPanel {
  constructor(root, room) {
    this.room = room;
    this.ticker = '$COIN';
    this.buying = false;
    this.ownBuyAts = [];
    this.seenTrades = new Set();
    this.lastMarket = null;

    const el = document.createElement('div');
    el.id = 'coin-panel';
    el.innerHTML = `
      <div class="cp-head">
        <img class="cp-coin" data-coinimg alt="" />
        <div class="cp-meta"><b data-ticker>$COIN</b><span data-mcap>MCAP —</span></div>
        <span class="cp-window" data-window data-gm-timer></span>
      </div>
      <canvas class="cp-chart" data-chart width="248" height="76"></canvas>
      <div class="cp-standings" data-gm-standings></div>
      <div class="cp-feed" data-feed></div>
      <div class="cp-allocrow"><span>YOUR ALLOCATION</span><b data-alloc>$0</b></div>
      <div class="cp-note" data-note></div>
      <button class="cp-buy" data-buy disabled>BUY</button>
      <div class="cp-hold" data-hold hidden></div>
    `;
    root.appendChild(el);
    this.el = Object.fromEntries(
      ['coinimg', 'ticker', 'mcap', 'window', 'chart', 'feed', 'alloc', 'note', 'buy', 'hold']
        .map((k) => [k, el.querySelector(`[data-${k}]`)]),
    );
    this.el.standings = el.querySelector('[data-gm-standings]');

    this.el.buy.addEventListener('click', () => this.buy());
    room.economy.subscribe(() => this.renderEconomy());
    room.market.subscribe((m) => {
      this.lastMarket = m;
      this.drawChart();
      for (const t of m.trades) {
        if (this.seenTrades.has(t.id)) continue;
        this.seenTrades.add(t.id);
        const usd = Math.round((Number(t.spendWei) / 1e18) * 3500);
        this.addFeed(`${t.player ?? 'someone'} ${t.side === 'buy' ? 'bought' : 'sold'} $${usd} of ${this.ticker}`);
      }
    });
    // The countdown is the one thing the surfaces don't push — tick it from room.now(),
    // the only clock the game may trust.
    this.windowTimer = setInterval(() => this.renderWindow(), 1_000);
    this.renderWindow();
    this.renderEconomy();
  }

  /** Dress the card with the launch's real identity — mock or live, it arrives the same way. */
  setCoin(symbol, name, imageSrc) {
    const clean = String(symbol ?? '').replace(/^\$/, '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 12);
    if (clean) this.ticker = `$${clean}`;
    this.el.ticker.textContent = this.ticker;
    this.el.coinimg.src = imageSrc;
    this.el.coinimg.alt = name || this.ticker;
    this.renderEconomy();
  }

  /**
   * THE standings seam (launch-ux.md item 4). entries: [{ player, dollars, you? }] sorted
   * best-first. Today it's fed by fixture rivals + your own room score; a cross-room feed
   * replaces the caller, never this renderer.
   */
  renderStandings(entries) {
    this.el.standings.innerHTML = entries
      .slice(0, 6)
      .map((e, i) =>
        `<div class="cp-row${e.you ? ' you' : ''}"${e.you ? ' data-gm-you' : ''}>` +
        `<span>#${i + 1}</span><b>${e.you ? 'you' : e.player}</b><em>$${e.dollars}</em></div>`)
      .join('');
  }

  renderWindow() {
    const closesAt = this.room.launch.current().closesAt;
    const left = closesAt - this.room.now();
    if (left <= 0) {
      this.el.window.textContent = 'WINDOW CLOSED';
      this.el.window.classList.add('closed');
      this.renderEconomy();
      clearInterval(this.windowTimer);
      return;
    }
    const m = Math.floor(left / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    this.el.window.textContent = `CLOSES ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /** Dollars from wei at the round's own entitlement rate (mock rate: 1 point = $1). */
  usd(wei) {
    return Number(wei / (this.room.economy.current().weiPerPoint ?? 10_000_000_000_000n));
  }

  renderEconomy() {
    const e = this.room.economy.current();
    const available = this.usd(e.availableWei);
    const spent = this.usd(e.spentWei);
    const held = this.usd(e.heldWei);
    const closed = this.room.launch.current().closesAt - this.room.now() <= 0;
    this.el.alloc.textContent = `$${available}`;
    this.el.buy.disabled = available <= 0 || this.buying || closed;
    this.el.buy.textContent = this.buying ? 'BUYING…'
      : available > 0 ? `BUY $${available} OF ${this.ticker}` : `BUY ${this.ticker}`;
    this.el.buy.classList.toggle('pulse', available > 0 && !this.buying && !closed);
    // Held ≠ spent: a declined wallet prompt leaves the allowance reserved for a few
    // minutes — show it, or the balance looks stolen (launch-ux.md item 7).
    this.el.hold.hidden = spent <= 0 && held <= 0;
    this.el.hold.textContent = held > 0
      ? `⏳ $${held} reserved until ${new Date(e.holdExpiresAt ?? 0).toLocaleTimeString()}`
      : `✅ you hold $${spent} of ${this.ticker}`;
    this.el.note.textContent = closed
      ? 'the buy window has closed'
      : available > 0
        ? 'allocation ≠ tokens — spend it before the window closes!'
        : spent > 0
          ? 'keep playing: every score is more to spend'
          : 'play to earn allocation';
  }

  buy() {
    if (this.buying) return;
    this.buying = true;
    this.renderEconomy();
    void this.room.economy.buy(this.room.economy.available()).then((r) => {
      this.buying = false;
      if (r.bought) {
        this.ownBuyAts.push(this.room.now());
        this.drawChart();
        this.addFeed(`you bought $${this.usd(r.spentWei)} of ${this.ticker} ✅`, true);
      } else {
        this.addFeed(`not bought: ${r.reason}`, true);
      }
      this.renderEconomy();
    });
  }

  noteClaim(dollars) {
    this.addFeed(`scored · +$${dollars} allocation`, true);
  }

  noteRefusal(code) {
    this.addFeed(REFUSAL_COPY[code] ?? code, true);
  }

  addFeed(text, mine = false) {
    const item = document.createElement('div');
    item.className = `cp-feed-item${mine ? ' mine' : ''}`;
    item.textContent = text;
    this.el.feed.prepend(item);
    while (this.el.feed.children.length > 3) this.el.feed.lastElementChild?.remove();
  }

  /** The coin's chart: price line, everyone's buys as coloured dots, your buys in gold. */
  drawChart() {
    const market = this.lastMarket;
    if (!market) return;
    const prices = market.prices;
    if (market.marketCapUsd !== null && prices.length > 1) {
      const factor = prices[prices.length - 1].priceEth / prices[0].priceEth;
      this.el.mcap.textContent = `MCAP $${Math.round((market.marketCapUsd * factor) / 1000)}K`;
    }
    const ctx = this.el.chart.getContext('2d');
    if (!ctx || prices.length < 2) return;
    const W = this.el.chart.width, H = this.el.chart.height;
    ctx.clearRect(0, 0, W, H);
    const t0 = prices[0].at, t1 = prices[prices.length - 1].at;
    let lo = Infinity, hi = -Infinity;
    for (const p of prices) { lo = Math.min(lo, p.priceEth); hi = Math.max(hi, p.priceEth); }
    const x = (at) => 6 + ((at - t0) / Math.max(1, t1 - t0)) * (W - 12);
    const y = (v) => H - 8 - ((v - lo) / Math.max(1e-12, hi - lo)) * (H - 16);
    const priceAt = (at) => {
      let best = prices[0].priceEth;
      for (const p of prices) if (p.at <= at) best = p.priceEth;
      return best;
    };
    ctx.beginPath();
    ctx.moveTo(x(prices[0].at), y(prices[0].priceEth));
    for (const p of prices) ctx.lineTo(x(p.at), y(p.priceEth));
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineTo(x(t1), H - 2);
    ctx.lineTo(x(t0), H - 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,215,106,.13)';
    ctx.fill();
    for (const t of market.trades) {
      const cx = x(t.at), cy = y(priceAt(t.at)); // pinned to the line, never a stray price
      ctx.beginPath();
      ctx.arc(cx, cy, t.side === 'buy' ? 4 : 2.8, 0, Math.PI * 2);
      ctx.fillStyle = t.side === 'buy' ? traderColor(t.player) : '#8a93a6';
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = '#0a0e16';
      ctx.stroke();
    }
    for (const at of this.ownBuyAts) {
      const cx = x(at), cy = y(priceAt(at));
      ctx.beginPath();
      ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd76a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff6df';
      ctx.stroke();
    }
  }
}
