/**
 * Assemble a single static site for Vercel from the three Game Mode ports.
 *
 * Builds 2048 (root), Minesweeper and Candle Dodger, then collects each dist
 * under the root dist/ as /2048, /minesweeper, /candledodger with a hub at the
 * top level (dist/index.html).
 *
 * Run: node tools/build-sites.mjs
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const games = [
  { name: '2048',   dir: root },
  { name: 'minesweeper',   dir: join(root, 'games', 'minesweeper') },
  { name: 'candledodger',  dir: join(root, 'games', 'candledodger') },
];

console.log('# Building game modes ...');
const tmp2048 = join(root, '.build-2048');
rmSync(dist, { recursive: true, force: true });
rmSync(tmp2048, { recursive: true, force: true });

for (const g of games) {
  if (g.name === '2048') {
    console.log('\n## 2048');
    // 2048 builds into root/dist by default; point it at a temp dir so the
    // assembled root/dist can hold all games + the hub page.
    execSync('npx vite build --outDir .build-2048', { cwd: g.dir, stdio: 'inherit' });
    continue;
  }
  console.log(`\n## ${g.name}`);
  execSync('npm run build', { cwd: g.dir, stdio: 'inherit' });
}

console.log('\n# Assembling static site ...');
mkdirSync(dist, { recursive: true });

const entries = [
  { name: '2048',        src: tmp2048 },
  { name: 'minesweeper', src: join(root, 'games', 'minesweeper', 'dist') },
  { name: 'candledodger', src: join(root, 'games', 'candledodger', 'dist') },
];

for (const { name, src } of entries) {
  if (!existsSync(src)) throw new Error(`missing build for ${name}: ${src}`);
  cpSync(src, join(dist, name), { recursive: true });
}

rmSync(tmp2048, { recursive: true, force: true });

console.log('# Writing hub page ...');
writeFileSync(
  join(dist, 'index.html'),
  String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flaunch Game Modes</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    background: radial-gradient(1200px 700px at 50% -20%, #2b2433 0%, #17121c 55%, #0d0a12 100%);
    font-family: "Helvetica Neue", Arial, sans-serif;
    color: #ece6f2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 40px;
    padding: 48px 20px;
  }
  h1 { font-size: 42px; font-weight: 900; letter-spacing: .12em; color: #3ddc84; text-shadow: 0 0 30px rgba(61,220,132,.4); }
  .subtitle { font-size: 16px; color: #9a90a8; margin-top: -28px; }
  .games { display: flex; gap: 28px; flex-wrap: wrap; justify-content: center; max-width: 900px; }
  .card { width: 260px; background: #1f1926; border: 1px solid #2f2638; border-radius: 16px; padding: 28px 24px; text-decoration: none; color: inherit; transition: transform .15s ease, box-shadow .15s ease; display: flex; flex-direction: column; gap: 12px; }
  .card:hover { transform: translateY(-4px); box-shadow: 0 12px 32px rgba(0,0,0,.5); }
  .card-icon { width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: bold; }
  .card h2 { font-size: 22px; font-weight: 800; }
  .card p { font-size: 14px; color: #9a90a8; line-height: 1.5; }
  .card-tag { display: inline-block; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; width: fit-content; letter-spacing: .06em; }
  .c-2048 .card-icon { background: linear-gradient(135deg, #f9f6f2, #ede0c8); color: #8e6b2f; border: 2px solid #8e6b2f; }
  .c-2048 h2 { color: #f2b53a; } .c-2048 .card-tag { background: #f2b53a22; color: #f2b53a; }
  .c-ms .card-icon { background: #ffe6ee; color: #e63e75; border: 2px solid #ff5f8f; }
  .c-ms h2 { color: #ff5f8f; } .c-ms .card-tag { background: #ff5f8f22; color: #ff5f8f; }
  .c-cd .card-icon { background: #0e0b12; color: #3ddc84; border: 2px solid #3ddc84; box-shadow: 0 0 12px rgba(61,220,132,.3); }
  .c-cd h2 { color: #3ddc84; } .c-cd .card-tag { background: #3ddc8422; color: #3ddc84; }
  .footer { font-size: 12px; color: #5a5068; margin-top: 24px; }
  .footer a { color: #9a90a8; }
</style>
</head>
<body>
  <h1>FLAUNCH GAME MODES</h1>
  <p class="subtitle">Play to earn allocation in a live coin launch</p>
  <div class="games">
    <a class="card c-2048" href="/2048/">
      <div class="card-icon">2</div>
      <h2>2048</h2>
      <p>Slide tiles to merge numbers. Every merge earns allocation at $0.001 per point.</p>
      <span class="card-tag">CLASSIC PUZZLE</span>
    </a>
    <a class="card c-ms" href="/minesweeper/">
      <div class="card-icon">&#128163;</div>
      <h2>Minesweeper</h2>
      <p>Reveal safe cells to earn allocation. Flood-fills pay in one beat at $0.001 per cell.</p>
      <span class="card-tag">LOGIC &middot; 16&times;16</span>
    </a>
    <a class="card c-cd" href="/candledodger/">
      <div class="card-icon">&#9670;</div>
      <h2>Candle Dodger</h2>
      <p>Dodge red price candles, catch green ones. Every second survived earns $0.005, green catches pay $0.02.</p>
      <span class="card-tag">ENDLESS RUNNER &middot; DARK</span>
    </a>
  </div>
  <p class="footer">Built with the <a href="https://github.com/flayerlabs/gamemode-sdk">Flaunch Game Mode SDK</a></p>
</body>
</html>`,
);

console.log('# Done. Site assembled in dist/');
