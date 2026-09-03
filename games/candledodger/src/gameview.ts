//
// Trading Simulator · Price Action Engine
//
// Simulates real market price action with candlesticks, volatility,
// and trend patterns. The player trades by buying and selling positions.
// Educational elements teach risk management and trading psychology.
//

export interface TradingHooks {
  /** Called when a trade is executed (buy or sell). */
  onTrade: (side: 'buy' | 'sell', price: number, quantity: number, value: number) => void;
  /** Called when position P&L updates. */
  onPnLUpdate: (unrealizedPnl: number, realizedPnl: number) => void;
  /** Called on price tick for chart updates. */
  onPriceTick: (price: number, high24h: number, low24h: number) => void;
}

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

interface Position {
  side: 'long' | 'short' | null;
  entryPrice: number;
  quantity: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

interface Order {
  id: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  value: number;
  timestamp: number;
  pnl?: number;
}

const CHART_WIDTH = 600;
const CHART_HEIGHT = 300;
const CANDLE_COUNT = 40;
const TICK_INTERVAL = 1000; // 1 second ticks

export class TradingSimulator {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hooks: TradingHooks;

  private currentPrice = 100;
  private startPrice = 100;
  private candles: Candle[] = [];
  private currentCandle: Candle | null = null;
  private candleTimer = 0;
  private candleDuration = 5; // 5 seconds per candle

  private position: Position = { side: null, entryPrice: 0, quantity: 0, stopLoss: null, takeProfit: null };
  private balance = 10000; // Starting balance $10,000
  private orders: Order[] = [];

  private high24h = 100;
  private low24h = 100;
  private tickCount = 0;
  private volatility = 0.015;
  private trend = 0;

  private running = false;
  private raf = 0;
  private lastT = 0;
  private tickAccum = 0;

  // UI State
  private showOrderPanel = false;
  private orderSide: 'buy' | 'sell' = 'buy';
  private orderQuantity = 1;

  constructor(canvas: HTMLCanvasElement, hooks: TradingHooks) {
    this.canvas = canvas;
    this.hooks = hooks;
    canvas.width = CHART_WIDTH;
    canvas.height = CHART_HEIGHT;
    this.ctx = canvas.getContext('2d')!;

    // Initialize with some candles
    this.initCandles();

    // Keyboard controls
    window.addEventListener('keydown', (e) => {
      if (e.key === 'b' || e.key === 'B') this.buy();
      if (e.key === 's' || e.key === 'S') this.sell();
      if (e.key === 'Escape') this.closePosition();
    });
  }

  private initCandles() {
    let price = this.startPrice;
    for (let i = 0; i < CANDLE_COUNT; i++) {
      const open = price;
      const change = (Math.random() - 0.5) * this.volatility * price;
      const close = Math.max(1, open + change);
      const high = Math.max(open, close) + Math.random() * this.volatility * price * 0.5;
      const low = Math.min(open, close) - Math.random() * this.volatility * price * 0.5;
      const volume = Math.floor(Math.random() * 1000) + 500;

      this.candles.push({
        open, high, low, close,
        volume,
        timestamp: Date.now() - (CANDLE_COUNT - i) * this.candleDuration * 1000
      });
      price = close;
    }
    this.currentPrice = price;
    this.high24h = Math.max(...this.candles.map(c => c.high));
    this.low24h = Math.min(...this.candles.map(c => c.low));
  }

  start() {
    this.running = true;
    this.lastT = performance.now();
    this.tickAccum = 0;
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick(t: number) {
    if (!this.running) return;
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;

    this.tickAccum += dt;
    if (this.tickAccum >= TICK_INTERVAL / 1000) {
      this.tickAccum = 0;
      this.tickPrice();
    }

    this.updateCandle(dt);
    this.checkStopLoss();
    this.checkTakeProfit();
    this.draw();

    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private tickPrice() {
    this.tickCount++;

    // Mean-reverting random walk with occasional trends
    if (this.tickCount % 30 === 0) {
      this.trend = (Math.random() - 0.5) * 0.02;
      this.volatility = 0.01 + Math.random() * 0.02;
    }

    const drift = this.trend;
    const noise = (Math.random() - 0.5) * this.volatility;
    const meanReversion = (this.startPrice - this.currentPrice) / this.startPrice * 0.001;

    const change = drift + noise + meanReversion;
    this.currentPrice = Math.max(1, this.currentPrice * (1 + change));

    // Update 24h high/low
    this.high24h = Math.max(this.high24h, this.currentPrice);
    this.low24h = Math.min(this.low24h, this.currentPrice);

    this.hooks.onPriceTick(this.currentPrice, this.high24h, this.low24h);
    this.updatePnL();
  }

  private updateCandle(dt: number) {
    this.candleTimer += dt;

    if (!this.currentCandle) {
      this.currentCandle = {
        open: this.currentPrice,
        high: this.currentPrice,
        low: this.currentPrice,
        close: this.currentPrice,
        volume: 0,
        timestamp: Date.now()
      };
    }

    this.currentCandle.close = this.currentPrice;
    this.currentCandle.high = Math.max(this.currentCandle.high, this.currentPrice);
    this.currentCandle.low = Math.min(this.currentCandle.low, this.currentPrice);
    this.currentCandle.volume += Math.floor(Math.random() * 50);

    if (this.candleTimer >= this.candleDuration) {
      this.candles.push(this.currentCandle);
      if (this.candles.length > CANDLE_COUNT) this.candles.shift();
      this.currentCandle = null;
      this.candleTimer = 0;
    }
  }

  private updatePnL() {
    if (!this.position.side) return;

    let unrealizedPnl = 0;
    if (this.position.side === 'long') {
      unrealizedPnl = (this.currentPrice - this.position.entryPrice) * this.position.quantity;
    } else {
      unrealizedPnl = (this.position.entryPrice - this.currentPrice) * this.position.quantity;
    }

    const realizedPnl = this.orders.reduce((sum, o) => sum + (o.pnl || 0), 0);
    this.hooks.onPnLUpdate(unrealizedPnl, realizedPnl);
  }

  private checkStopLoss() {
    if (!this.position.side || !this.position.stopLoss) return;

    if (this.position.side === 'long' && this.currentPrice <= this.position.stopLoss) {
      this.closePosition('stop loss triggered');
    } else if (this.position.side === 'short' && this.currentPrice >= this.position.stopLoss) {
      this.closePosition('stop loss triggered');
    }
  }

  private checkTakeProfit() {
    if (!this.position.side || !this.position.takeProfit) return;

    if (this.position.side === 'long' && this.currentPrice >= this.position.takeProfit) {
      this.closePosition('take profit triggered');
    } else if (this.position.side === 'short' && this.currentPrice <= this.position.takeProfit) {
      this.closePosition('take profit triggered');
    }
  }

  // Trading Actions
  buy() {
    if (this.position.side === 'long') return; // Already long
    if (this.position.side === 'short') this.closePosition('closing short to go long');

    const quantity = this.orderQuantity;
    const value = this.currentPrice * quantity;
    if (value > this.balance) return;

    this.position = {
      side: 'long',
      entryPrice: this.currentPrice,
      quantity,
      stopLoss: this.currentPrice * 0.95, // 5% stop loss
      takeProfit: this.currentPrice * 1.10  // 10% take profit
    };

    this.balance -= value;

    const order: Order = {
      id: `buy-${Date.now()}`,
      side: 'buy',
      price: this.currentPrice,
      quantity,
      value,
      timestamp: Date.now()
    };
    this.orders.push(order);

    this.hooks.onTrade('buy', this.currentPrice, quantity, value);
    this.updatePnL();
  }

  sell() {
    if (!this.position.side) return; // No position to sell

    this.closePosition('manual sell');
  }

  closePosition(reason = 'position closed') {
    if (!this.position.side) return;

    let pnl = 0;
    if (this.position.side === 'long') {
      pnl = (this.currentPrice - this.position.entryPrice) * this.position.quantity;
    } else {
      pnl = (this.position.entryPrice - this.currentPrice) * this.position.quantity;
    }

    const value = this.currentPrice * this.position.quantity;
    this.balance += value + pnl;

    const order: Order = {
      id: `sell-${Date.now()}`,
      side: 'sell',
      price: this.currentPrice,
      quantity: this.position.quantity,
      value,
      timestamp: Date.now(),
      pnl
    };
    this.orders.push(order);

    this.hooks.onTrade('sell', this.currentPrice, this.position.quantity, value);

    this.position = { side: null, entryPrice: 0, quantity: 0, stopLoss: null, takeProfit: null };
    this.updatePnL();
  }

  setStopLoss(price: number) {
    if (this.position.side) {
      this.position.stopLoss = price;
    }
  }

  setTakeProfit(price: number) {
    if (this.position.side) {
      this.position.takeProfit = price;
    }
  }

  setOrderQuantity(qty: number) {
    this.orderQuantity = Math.max(1, Math.min(100, qty));
  }

  // Getters
  getCurrentPrice() { return this.currentPrice; }
  getBalance() { return this.balance; }
  getPosition() { return { ...this.position }; }
  getOrders() { return [...this.orders]; }
  getCandles() { return [...this.candles, ...(this.currentCandle ? [this.currentCandle] : [])]; }

  // Drawing
  private draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, CHART_WIDTH, CHART_HEIGHT);

    this.drawChart();
    this.drawPriceInfo();
    if (this.position.side) this.drawPositionInfo();
  }

  private drawChart() {
    const { ctx } = this;
    const allCandles = this.getCandles();
    if (allCandles.length < 2) return;

    const padding = { top: 20, right: 60, bottom: 30, left: 10 };
    const chartW = CHART_WIDTH - padding.left - padding.right;
    const chartH = CHART_HEIGHT - padding.top - padding.bottom;

    // Find price range
    let minPrice = Infinity, maxPrice = -Infinity;
    for (const c of allCandles) {
      minPrice = Math.min(minPrice, c.low);
      maxPrice = Math.max(maxPrice, c.high);
    }
    const priceRange = maxPrice - minPrice || 1;
    const pricePadding = priceRange * 0.1;
    minPrice -= pricePadding;
    maxPrice += pricePadding;

    // Draw background
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, CHART_WIDTH, CHART_HEIGHT);

    // Draw grid
    ctx.strokeStyle = 'rgba(96,190,255,0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (i / 5) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(CHART_WIDTH - padding.right, y);
      ctx.stroke();

      // Price labels
      const price = maxPrice - (i / 5) * (maxPrice - minPrice);
      ctx.fillStyle = 'rgba(160,220,255,0.6)';
      ctx.font = '10px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(`$${price.toFixed(2)}`, CHART_WIDTH - padding.right + 5, y + 3);
    }

    // Draw candles
    const candleW = Math.max(4, (chartW / allCandles.length) * 0.7);
    const gap = chartW / allCandles.length;

    for (let i = 0; i < allCandles.length; i++) {
      const c = allCandles[i];
      const x = padding.left + i * gap + gap / 2;

      const openY = padding.top + ((maxPrice - c.open) / (maxPrice - minPrice)) * chartH;
      const closeY = padding.top + ((maxPrice - c.close) / (maxPrice - minPrice)) * chartH;
      const highY = padding.top + ((maxPrice - c.high) / (maxPrice - minPrice)) * chartH;
      const lowY = padding.top + ((maxPrice - c.low) / (maxPrice - minPrice)) * chartH;

      const isGreen = c.close >= c.open;
      const color = isGreen ? '#3ddc84' : '#ff5f8f';

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      ctx.fillStyle = color;
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(1, Math.abs(closeY - openY));
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyHeight);
    }

    // Draw current price line
    const priceY = padding.top + ((maxPrice - this.currentPrice) / (maxPrice - minPrice)) * chartH;
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(padding.left, priceY);
    ctx.lineTo(CHART_WIDTH - padding.right, priceY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Current price label
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`$${this.currentPrice.toFixed(2)}`, CHART_WIDTH - padding.right + 5, priceY - 5);

    // Draw position entry line if in position
    if (this.position.side) {
      const entryY = padding.top + ((maxPrice - this.position.entryPrice) / (maxPrice - minPrice)) * chartH;
      ctx.strokeStyle = this.position.side === 'long' ? '#3ddc84' : '#ff5f8f';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padding.left, entryY);
      ctx.lineTo(CHART_WIDTH - padding.right, entryY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = this.position.side === 'long' ? '#3ddc84' : '#ff5f8f';
      ctx.fillText(`Entry: $${this.position.entryPrice.toFixed(2)}`, padding.left + 5, entryY - 5);

      // Draw stop loss line
      if (this.position.stopLoss) {
        const slY = padding.top + ((maxPrice - this.position.stopLoss) / (maxPrice - minPrice)) * chartH;
        ctx.strokeStyle = '#ff3d5a';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(padding.left, slY);
        ctx.lineTo(CHART_WIDTH - padding.right, slY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ff3d5a';
        ctx.fillText(`SL: $${this.position.stopLoss.toFixed(2)}`, padding.left + 5, slY + 12);
      }

      // Draw take profit line
      if (this.position.takeProfit) {
        const tpY = padding.top + ((maxPrice - this.position.takeProfit) / (maxPrice - minPrice)) * chartH;
        ctx.strokeStyle = '#3ddc84';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(padding.left, tpY);
        ctx.lineTo(CHART_WIDTH - padding.right, tpY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#3ddc84';
        ctx.fillText(`TP: $${this.position.takeProfit.toFixed(2)}`, padding.left + 5, tpY + 12);
      }
    }
  }

  private drawPriceInfo() {
    const { ctx } = this;
    const change = ((this.currentPrice - this.startPrice) / this.startPrice) * 100;
    const isUp = change >= 0;

    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, CHART_WIDTH, 20);

    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ece6f2';
    ctx.fillText('BTC/USD', 10, 14);

    ctx.font = 'bold 14px Arial';
    ctx.fillStyle = isUp ? '#3ddc84' : '#ff5f8f';
    ctx.fillText(`$${this.currentPrice.toFixed(2)}`, 70, 14);

    ctx.font = '11px Arial';
    ctx.fillText(`${isUp ? '+' : ''}${change.toFixed(2)}%`, 160, 14);

    ctx.fillStyle = 'rgba(160,220,255,0.6)';
    ctx.font = '10px Arial';
    ctx.fillText(`24h H: $${this.high24h.toFixed(2)} L: $${this.low24h.toFixed(2)}`, 220, 14);
  }

  private drawPositionInfo() {
    const { ctx } = this;
    const y = CHART_HEIGHT - 25;

    ctx.fillStyle = 'rgba(10,14,22,0.9)';
    ctx.fillRect(0, CHART_HEIGHT - 45, CHART_WIDTH, 45);

    let unrealizedPnl = 0;
    if (this.position.side === 'long') {
      unrealizedPnl = (this.currentPrice - this.position.entryPrice) * this.position.quantity;
    } else {
      unrealizedPnl = (this.position.entryPrice - this.currentPrice) * this.position.quantity;
    }

    const isProfit = unrealizedPnl >= 0;

    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ece6f2';
    ctx.fillText(`${this.position.side?.toUpperCase()} ${this.position.quantity} @ $${this.position.entryPrice.toFixed(2)}`, 10, y);

    ctx.fillStyle = isProfit ? '#3ddc84' : '#ff5f8f';
    ctx.fillText(`${isProfit ? '+' : ''}$${unrealizedPnl.toFixed(2)} (${((unrealizedPnl / (this.position.entryPrice * this.position.quantity)) * 100).toFixed(2)}%)`, 200, y);

    ctx.fillStyle = 'rgba(160,220,255,0.6)';
    ctx.font = '10px Arial';
    ctx.fillText(`Balance: $${this.balance.toFixed(2)}`, 10, y + 15);
  }
}