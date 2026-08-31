import { createMockRoom, replayMarket } from '@flayerlabs/gamemode-client';
import { rules } from '../game/rules.ts';

// The mock's entitlement rate is 1 rules point = $1 of allocation. The client never
// hardcodes it: read `weiPerPoint` from the economy balance.
/** TODO: the three economy numbers you designed in step 2 of the skill. */
const CONFIG = {
  pointsPerGamePoint: 10,
  maxGamePoints: 15,
  minMsBetweenClaims: 4_000,
  maxClaimPoints: 3,
};

// Dev/QA params (mock-only): ?practice=SECONDS shortens the practice lobby,
// ?round=SECONDS shortens the launch window so the end screen is reachable in tests.
const params = new URLSearchParams(location.search);
const PRACTICE_MS = (params.has('practice') ? Number(params.get('practice')) : 45) * 1000;
const ROUND_MS = (params.has('round') ? Number(params.get('round')) : 8 * 60) * 1000;

/** The fixture cast: rivals who trade on the chart, talk in the feed, and fill the leaderboard. */
export const RIVAL_NAMES = ['BUCKETS', 'DIMES', 'GLASS', 'MIDRANGE', 'HANDLES', 'SWATS']; // TODO: rename to fit the game

/**
 * A mock launch scaled to the window: quiet open, a spike as word gets around, late rally.
 * Played through the SAME room.market surface a live Flaunch adapter feeds — the chart code
 * you write against this is the chart code that ships.
 */
function launchMarket() {
  const prices = [];
  let p = 0.000_011;
  const steps = Math.max(12, Math.floor(ROUND_MS / 5_000));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wave = Math.sin(i * 1.9) * 0.05 + Math.sin(i * 0.47) * 0.09;
    const spike = t > 0.3 && t < 0.45 ? (t - 0.3) * 5 : 0;
    p = Math.max(0.000_007, p * (1 + 0.012 + wave * 0.11 + spike * 0.025));
    prices.push({ afterMs: 8_000 + i * 5_000, priceEth: p });
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

/**
 * The mock room, running the game's REAL rules module. Live rooms carry the real coin's
 * name/symbol/art; the game reads everything from room.launch either way, so the mock coin
 * below is data, not a hardcode.
 */
export function createGameModeRoom() {
  const opensAt = Date.now() + PRACTICE_MS; // play before opensAt is the practice lobby
  return createMockRoom(rules, {
    config: CONFIG,
    seed: 1, // pin so a reload is the same round
    lobbyMs: PRACTICE_MS,
    roundMs: ROUND_MS,
    platform: { market: replayMarket(launchMarket()) },
    launch: {
      roundId: 'mock',
      poolId: 'mock',
      coinAddress: null,
      name: 'Mock Coin',   // TODO: a coin that fits the game
      symbol: 'MOCK',      // TODO
      imageUrl: null,      // null = the world flies the procedural coin render (coinArt.js)
      opensAt,
      closesAt: opensAt + ROUND_MS,
      booksCloseAt: opensAt + ROUND_MS,
    },
  });
}
