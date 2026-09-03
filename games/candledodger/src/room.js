import { createMockRoom, replayMarket } from '@flayerlabs/gamemode-client';
import { rules } from './game/rules.ts';

const CONFIG = {
  pointsPerTradeValue: 0.5,  // 0.5 points per unit of trade value
  pointsPerPnl: 10,          // 10 points per point of net P&L
  maxTradeValue: 50000,      // max trade value in a round
  maxPnl: 1000,              // max net P&L (in points) the round can award
  maxClaimTradeValue: 1000,  // max trade value per claim
  minMsBetweenClaims: 1_000, // minimum 1 second between claims
};

// Dev/QA params (mock-only): ?practice=SECONDS, ?round=SECONDS.
const params = new URLSearchParams(location.search);
const PRACTICE_MS = (params.has('practice') ? Number(params.get('practice')) : 30) * 1000;
const ROUND_MS = (params.has('round') ? Number(params.get('round')) : 7 * 60) * 1000;

/** The fixture cast: rivals who trade on the chart, talk in the feed, fill the leaderboard. */
export const RIVAL_NAMES = ['DODGER', 'WICK', 'BULLISH', 'BEARHUG', 'SPIKE', 'DIPPER'];

/** A mock launch scaled to the window: quiet open, spike, late rally. */
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
  const opensAt = Date.now() + PRACTICE_MS;
  return createMockRoom(rules, {
    config: CONFIG,
    seed: 1,
    lobbyMs: PRACTICE_MS,
    roundMs: ROUND_MS,
    pointsPerDollar: 1000, // $0.001 per point
    platform: { market: replayMarket(launchMarket()) },
    launch: {
      roundId: 'mock',
      poolId: 'mock',
      coinAddress: null,
      name: 'Trading Simulator',
      symbol: 'TSIM',
      imageUrl: null,
      opensAt,
      closesAt: opensAt + ROUND_MS,
      booksCloseAt: opensAt + ROUND_MS,
    },
  });
}