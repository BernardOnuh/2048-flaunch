//
// Candle Dodger · runner engine
//
// A dark, endless runner. The player steers a runner up/down through a scrolling lane of
// PRICE CANDLES: red/down candles are obstacles to dodge, green candles are boosts to catch.
// Every whole second survived scores a survival tick; each green candle caught is a bonus.
//
// The engine NEVER awards points. It only reports progress — the wall time survived since the
// last tick (`seconds`) and how many green candles were caught (`greens`) — through a seam the
// rules module, running server-side, uses to bound claims. The live chart look is a visual skin
// on top of a deterministic lane.
//

export interface RunnerHooks {
  /** Called at most once per ~1s of real survival while playing. `seconds` is whole seconds. */
  onSurvive: (seconds: number) => void;
  /** Called when a green candle is caught. */
  onGreen: () => void;
  onCrash: () => void;
}

interface Candle {
  x: number; // world x (scrolling right to left)
  lane: number; // 0..laneCount-1
  kind: 'red' | 'green';
  w: number;
  h: number;
}

export class RunnerGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hooks: RunnerHooks;

  private W = 720;
  private H = 420;
  private laneCount = 4;
  private laneH = 0;
  private playerLane = 1.5;
  private speed = 180; // px/s
  private candles: Candle[] = [];
  private spawnTimer = 0;
  private surviveAccum = 0;
  private time = 0;
  private running = false;
  private raf = 0;
  private lastT = 0;
  private phase = 0;

  constructor(canvas: HTMLCanvasElement, hooks: RunnerHooks) {
    this.canvas = canvas;
    this.hooks = hooks;
    canvas.width = this.W;
    canvas.height = this.H;
    this.ctx = canvas.getContext('2d')!;
    this.laneH = this.H / this.laneCount;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w') this.moveLane(-1);
      if (e.key === 'ArrowDown' || e.key === 's') this.moveLane(1);
    });
    canvas.addEventListener('pointerdown', (e) => {
      const y = e.offsetY;
      this.moveLane(y < this.H / 2 ? -1 : 1);
    });
  }

  start() {
    this.running = true;
    this.lastT = performance.now();
    this.phase = 0;
    this.candles = [];
    this.spawnTimer = 0;
    this.surviveAccum = 0;
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  moveLane(dir: number) {
    const next = this.playerLane + dir;
    if (next >= 0 && next < this.laneCount) this.playerLane = next;
  }

  private tick(t: number) {
    if (!this.running) return;
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    this.time += dt;
    this.phase += dt;
    this.speed = 180 + this.phase * 14;

    this.candles.forEach((c) => (c.x -= this.speed * dt));
    this.candles = this.candles.filter((c) => c.x > -c.w - 20);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawn();
      this.spawnTimer = 0.6 + Math.random() * 0.7;
    }

    this.checkCollisions();
    this.tickSurvival(dt);
    this.draw();

    if (this.running) this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private spawn() {
    const lane = Math.floor(Math.random() * this.laneCount);
    const kind: 'red' | 'green' = Math.random() < 0.18 ? 'green' : 'red';
    const h = 36 + Math.random() * 40;
    this.candles.push({ x: this.W + 20, lane, kind, w: 34, h });
  }

  private playerRect() {
    const cy = (this.playerLane + 0.5) * this.laneH;
    return { x: 120, y: cy - 18, w: 30, h: 36 };
  }

  private checkCollisions() {
    const p = this.playerRect();
    for (const c of this.candles) {
      if (c.x > p.x + p.w || c.x + c.w < p.x) continue;
      const cy = (c.lane + 0.5) * this.laneH;
      const top = cy - c.h / 2, bottom = cy + c.h / 2;
      if (top > p.y + p.h || bottom < p.y) continue;
      if (c.kind === 'red') {
        this.running = false;
        this.hooks.onCrash();
        this.draw();
        return;
      }
      // green catch
      this.candles = this.candles.filter((x) => x !== c);
      this.hooks.onGreen();
    }
  }

  private tickSurvival(dt: number) {
    this.surviveAccum += dt;
    if (this.surviveAccum >= 1) {
      const whole = Math.floor(this.surviveAccum);
      this.hooks.onSurvive(whole);
      this.surviveAccum -= whole;
    }
  }

  private draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // lane dividers
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < this.laneCount; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * this.laneH);
      ctx.lineTo(W, i * this.laneH);
      ctx.stroke();
    }

    for (const c of this.candles) this.drawCandle(c);

    // player runner (a coin)
    const p = this.playerRect();
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 17, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcc4d';
    ctx.fill();
    ctx.strokeStyle = '#e6a93b';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#8a6a1e';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', cx, cy + 1);
  }

  private drawCandle(c: Candle) {
    const { ctx } = this;
    const cy = (c.lane + 0.5) * this.laneH;
    const top = cy - c.h / 2, bottom = cy + c.h / 2;
    const isRed = c.kind === 'red';
    ctx.fillStyle = isRed ? '#ff5f8f' : '#3ddc84';
    ctx.fillRect(c.x, top, c.w, c.h);
    // wick
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x + c.w / 2, top - 8);
    ctx.lineTo(c.x + c.w / 2, bottom + 8);
    ctx.stroke();
  }
}
