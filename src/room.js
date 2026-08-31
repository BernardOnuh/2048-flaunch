import { createMockRoom, replayMarket } from '@flayerlabs/gamemode-client';
import { rules } from './game/rules.ts';

/**
 * The three economy numbers designed in the port skill step 2, for 2048:
 *
 *  - pointsPerGamePoint = 1        (§0.001 per point scored, via weiPerPoint)
 *  - maxGamePoints      = 75,000   (a strong player's finale; the reward ceiling $50–75)
 *  - minMsBetweenClaims = 2,000    (a swipe is the claim event; 2s between swipes)
 *  - maxClaimPoints     = 32,768   (the most one swipe can merge)
 *
 * The dollars come from the room's rate: the mock derives `weiPerPoint` from
 * `pointsPerDollar = 1000` (a dollar buys 1000 points => $0.001 per point). The client reads
 * `weiPerPoint` off the economy balance — never a hardcoded number.
 */
const CONFIG = {
  pointsPerGamePoint: 1,
  maxGamePoints: 75_000,
  minMsBetweenClaims: 2_000,
  maxClaimPoints: 32_768,
};

// Dev/QA params (mock-only): ?practice=SECONDS shortens the practice lobby,
// ?round=SECONDS shortens the launch window so the end screen is reachable in tests.
const params = new URLSearchParams(location.search);
const PRACTICE_MS = (params.has('practice') ? Number(params.get('practice')) : 45) * 1000;
const ROUND_MS = (params.has('round') ? Number(params.get('round')) : 8 * 60) * 1000;

/** The fixture cast: rivals who trade on the chart, talk in the feed, and fill the leaderboard. */
export const RIVAL_NAMES = ['TETRIS', 'SUDOKU', 'CROSSY', 'PEGGLE', 'BEJEWELED', 'MINES'];

/** A mock launch scaled to the window: quiet open, a spike as word gets around, late rally. */
function launchMarket() {
  const prices = [];
  let p = 0.000_011;
  const steps = Math.max(12, Math.floor(ROUND_MS / 5_000));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wave = Math.sin(i * 1.9) * 0.05 + Math.sin(i * 0.47) * 0.09;
    const spike = t > 0.3 && t < 0.45 ? (t - 0.3) * 5 : 0;
    p = Math.max(0.000_007, p * (1 + 0.012 + wave * 0.11 + spike * 0.025));
    prices.push({ afterMs: i * 2_500, priceEth: p });
  }
  const gap = Math.max(15_000, Math.floor(ROUND_MS / (RIVAL_NAMES.length + 2)));
  const trades = RIVAL_NAMES.map((name, i) => ({
    afterMs: 20_000 + i * gap,
    player: name,
    side: 'buy',
    spendWei: BigInt(6 + ((i * 11) % 34)) * 1_000_000_000_000_000n,
    priceEth: prices[Math.min(prices.length - 1, i * 8)].priceEth,
  }));
  return { marketCapUsd: 262_000, prices, trades };
}

/** The mock room, running the game's REAL rules module. */
export function createGameModeRoom() {
  const opensAt = Date.now() + PRACTICE_MS; // play before opensAt is the practice lobby
  return createMockRoom(rules, {
    config: CONFIG,
    seed: 1, // pin so a reload is the same round
    lobbyMs: PRACTICE_MS,
    roundMs: ROUND_MS,
    pointsPerDollar: 1000, // $0.001 per point — the port's "dollars per scoring event"
    platform: { market: replayMarket(launchMarket()) },
    launch: {
      roundId: 'mock',
      poolId: 'mock',
      coinAddress: null,
      name: '2048',
      symbol: '2048',
      imageUrl: null, // null = the world flies the procedural coin render (coinArt.js)
      opensAt,
      closesAt: opensAt + ROUND_MS,
      booksCloseAt: opensAt + ROUND_MS,
    },
  });
}
