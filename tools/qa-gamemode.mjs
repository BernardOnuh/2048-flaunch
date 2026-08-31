/**
 * Game Mode port acceptance harness.
 *
 * Copy into the port as tools/qa-gamemode.mjs, set CONFIG, run: node tools/qa-gamemode.mjs
 *
 * It boots the game headless and walks the whole launch: tutorial on first run, practice
 * gating, a claim awarding, a too-fast claim refusing, chart pixels, BUY confirming, the
 * end screen with summary + leaderboard — and saves lobby / mid-round / end screenshots.
 * Green here plus a human look at the screenshots is the port's definition of done.
 *
 * The port must provide (see references/patterns.md "Dev/QA hooks"):
 *   window.__gm = { room, claim(pts?), resetFirstRun() }
 *   URL params ?practice=SECONDS and ?round=SECONDS (mock-only)
 *   the data-gm-* / data-* DOM contract from references/launch-ux.md
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const CONFIG = {
  root: new URL('..', import.meta.url).pathname, // the port's repo root
  readySignal: () => `window.__gm?.room !== undefined`, // when the game is booted
  practiceSecs: 8,
  roundSecs: 45,
};

const port = 5197;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [`${CONFIG.root}/node_modules/vite/bin/vite.js`, '--host', '127.0.0.1', '--port', String(port)],
  { cwd: CONFIG.root, stdio: 'ignore' },
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

let browser;
try {
  // wait for vite
  const deadline = Date.now() + 20_000;
  for (;;) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error('vite not ready');
    await new Promise((r) => setTimeout(r, 150));
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== origin && !u.protocol.startsWith('data')) errors.push(`external request: ${r.url()}`);
  });

  const url = `${origin}/?practice=${CONFIG.practiceSecs}&round=${CONFIG.roundSecs}`;
  const q = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? { text: el.textContent, hidden: el.hidden || getComputedStyle(el).display === 'none' } : null;
  }, sel);
  const present = async (sel) => { const r = await q(sel); return r !== null && !r.hidden; };

  // ---- run 1: first run ----
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(CONFIG.readySignal(), null, { timeout: 60_000 });
  const opensAt = await page.evaluate(() => window.__gm.room.launch.current().opensAt);
  const closesAt = await page.evaluate(() => window.__gm.room.launch.current().closesAt);

  // tutorial
  check('tutorial shows on first run', await present('[data-gm-tutorial]'));
  for (let i = 0; i < 8 && (await present('[data-gm-tutorial]')); i++) {
    await page.click('[data-gm-tutorial-next]').catch(() => {});
    await page.waitForTimeout(200);
  }
  check('tutorial dismissible', !(await present('[data-gm-tutorial]')));

  // practice lobby
  check('practice framing before opensAt', await present('[data-gm-practice]'));
  check('tip-off countdown present', await present('[data-gm-tipoff]'));
  await page.screenshot({ path: 'qa-1-lobby.png' });

  // a practice claim must NOT award
  await page.evaluate(() => window.__gm.claim());
  await page.waitForTimeout(300);
  const practiceEarned = await page.evaluate(() => window.__gm.room.economy.current().earnedWei > 0n);
  check('practice claim does not award', !practiceEarned);

  // wait for the round to open
  await page.waitForFunction((t) => Date.now() >= t + 500, opensAt, { timeout: 30_000 });
  await page.waitForTimeout(400);
  check('practice framing gone after opensAt', !(await present('[data-gm-practice]')));
  check('round timer visible', await present('[data-gm-timer]'));

  // claim → award; instant re-claim → refusal
  await page.evaluate(() => window.__gm.claim());
  await page.waitForTimeout(300);
  const earned = await page.evaluate(() => { const e = window.__gm.room.economy.current(); return Number(e.earnedWei / (e.weiPerPoint ?? 10_000_000_000_000n)); });
  check('claim awards allocation', earned > 0, `$${earned}`);
  await page.evaluate(() => window.__gm.claim());
  await page.waitForTimeout(300);
  const earned2 = await page.evaluate(() => { const e = window.__gm.room.economy.current(); return Number(e.earnedWei / (e.weiPerPoint ?? 10_000_000_000_000n)); });
  check('instant re-claim refused', earned2 === earned);

  // chart + standings
  const chartDrawn = await page.evaluate(() => {
    const c = document.querySelector('[data-chart]');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  });
  check('market chart has pixels', chartDrawn);
  check('live standings present', await present('[data-gm-standings]'));
  check('player row in standings', await present('[data-gm-you]'));

  // buy
  await page.click('[data-buy]');
  await page.waitForTimeout(900);
  const hold = await q('[data-hold]');
  check('buy confirms and shows holding', hold !== null && !hold.hidden, hold?.text ?? '');
  await page.screenshot({ path: 'qa-2-midround.png' });

  // end screen at closesAt
  await page.waitForFunction((t) => Date.now() >= t + 1200, closesAt, { timeout: 90_000 });
  await page.waitForTimeout(600);
  check('end screen appears by closesAt', await present('[data-gm-endscreen]'));
  check('end screen has score summary', await present('[data-gm-summary]'));
  check('end screen has leaderboard', await present('[data-gm-lb]'));
  await page.screenshot({ path: 'qa-3-end.png' });

  // ---- run 2: tutorial persistence ----
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(CONFIG.readySignal(), null, { timeout: 60_000 });
  await page.waitForTimeout(600);
  check('tutorial does not repeat', !(await present('[data-gm-tutorial]')));

  check('zero console errors / external requests', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser?.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`} (${results.length} checks) — now LOOK at qa-1/2/3 screenshots.`);
process.exit(failed.length === 0 ? 0 : 1);
