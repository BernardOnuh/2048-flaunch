import { defineGame, type Decision, type PlayerId, type Refusal } from '@flayerlabs/gamemode-spec';

/**
 * Trading Simulator as a Game Mode — a trading-P&L sim with a bounded-claim shape.
 *
 * The simulator runs in the browser and cannot be trusted, so the rules never re-simulate it.
 * What CAN be bounded is the claim rhythm, the ceiling and the deduction floor:
 *
 *  - A claim reports trade value, P&L changes, and number of trades executed.
 *  - Claims are rate-limited by `minMsBetweenClaims`.
 *  - The cumulative cap `maxTradeValue` stops any total above the round's playable span.
 *
 * The rules award points based on trading performance:
 *  - Trade value awards points proportional to the trade size
 *  - Winning trades award bonus points
 *  - Losing trades deduct points (but never below zero)
 */

export interface Config {
  /** Allocation points per unit of trade value. */
  pointsPerTradeValue: number;
  /** Allocation points per point of net P&L (already net of wins/losses). */
  pointsPerPnl: number;
  /** Max trade value a player can bank in the round. */
  maxTradeValue: number;
  /** Max net P&L (in points) the round can award (the bound per player). */
  maxPnl: number;
  /** A single claim may represent at most this much trade value. */
  maxClaimTradeValue: number;
  /** The fastest honest rhythm between claims, measured by play: ~1s. */
  minMsBetweenClaims: number;
}

export interface State {
  config: Config;
  opensAt: number;
  endsAt: number;
  over: boolean;
  players: Record<PlayerId, { 
    gamePoints: number; 
    claims: number; 
    lastClaimAt: number; 
    tradeValue: number; 
    wins: number; 
    losses: number;
    pnlAccum: number;
  }>;
}

/**
 * A claim of trading progress since the last tick.
 *  - `seconds` is the trade value (in dollars).
 *  - `greens` is the P&L multiplied by 100 (to handle decimals as integers).
 *  - `reds` is the number of trades executed.
 */
export type Action = { kind: 'claim'; seconds: number; greens: number; reds: number };

export type Event =
  | { t: 'joined'; player: PlayerId }
  | { t: 'claimed'; player: PlayerId; tradeValue: number; pnl: number; trades: number; at: number }
  | { t: 'ended' };

const MAX_TRADES_PER_CLAIM = 10; // Max trades per claim

export const rules = defineGame<Config, State, Event, Action, PublicView, PlayerView>({
  id: 'candledodger',

  parseAction(input): Action | null {
    if (typeof input !== 'object' || input === null) return null;
    const keys = Object.keys(input).sort().join(',');
    if (keys !== 'greens,kind,reds,seconds') return null;
    const { kind, seconds, greens, reds } = input as { kind?: unknown; seconds?: unknown; greens?: unknown; reds?: unknown };
    if (kind !== 'claim') return null;
    if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 0 || seconds > 100000) return null;
    if (typeof greens !== 'number' || !Number.isInteger(greens) || greens < -10000 || greens > 10000) return null;
    if (typeof reds !== 'number' || !Number.isInteger(reds) || reds < 0 || reds > MAX_TRADES_PER_CLAIM) return null;
    return { kind, seconds, greens, reds };
  },

  initRound(config, seed, window) {
    void seed; // the trading simulation is visual in the browser; the rules bound claims, not re-simulate
    return { config, opensAt: window.opensAt, endsAt: window.closesAt, over: false, players: {} };
  },

  decide(state, command): Decision<Event> | Refusal {
    switch (command.kind) {
      case 'join':
        return state.players[command.player] === undefined
          ? { events: [{ t: 'joined', player: command.player }] }
          : { events: [] };

      case 'leave':
        return { events: [] };

      case 'wake':
        return state.over ? { events: [] } : { events: [{ t: 'ended' }] };

      case 'action': {
        const player = state.players[command.player];
        if (state.over) return { refuse: 'game.round_over' };
        if (command.at < state.opensAt) return { refuse: 'game.not_open' };
        if (player === undefined) return { refuse: 'game.not_playing' };
        if (command.at - player.lastClaimAt < state.config.minMsBetweenClaims) {
          return { refuse: 'claim.too_fast' };
        }
        const tradeValue = command.action.seconds;
        const pnl = command.action.greens;
        const trades = command.action.reds;
        if (tradeValue <= 0 && pnl <= 0 && trades <= 0) return { refuse: 'claim.nothing_scored' };
        // A single claim can't exceed max trade value.
        if (tradeValue > state.config.maxClaimTradeValue) return { refuse: 'action.too_big' };
        // Trade value can't bank past the round's maximum.
        const tradeValueLeft = Math.max(0, state.config.maxTradeValue - player.tradeValue);
        const tradeValueGranted = Math.min(tradeValue, tradeValueLeft);
        const cap = state.config.maxTradeValue * state.config.pointsPerTradeValue
          + state.config.maxPnl * state.config.pointsPerPnl;
        // Net: trade value adds, net P&L adds (a negative P&L already reflects losses.
        // The game floored P&L per trade at zero P&L from the integer, but we accept the
        // reported net and never let the running total of all players' awards go below zero.
        const delta = tradeValueGranted * state.config.pointsPerTradeValue
          + pnl * state.config.pointsPerPnl;
        const netNow = Math.max(0, player.gamePoints + delta);
        if (netNow > cap) return { refuse: 'claim.cap_reached' };
        const awardPoints = Math.max(0, netNow - player.gamePoints);
        const decision: Decision<Event> = {
          events: [{ t: 'claimed', player: command.player, tradeValue: tradeValueGranted, pnl, trades, at: command.at }],
        };
        if (awardPoints > 0) decision.awards = [{ player: command.player, points: awardPoints }];
        return decision;
      }
    }
  },

  evolve(state, event) {
    switch (event.t) {
      case 'joined':
        return {
          ...state,
          players: { ...state.players, [event.player]: { gamePoints: 0, claims: 0, lastClaimAt: 0, tradeValue: 0, wins: 0, losses: 0, pnlAccum: 0 } },
        };
      case 'claimed': {
        const p = state.players[event.player] ?? { gamePoints: 0, claims: 0, lastClaimAt: 0, tradeValue: 0, wins: 0, losses: 0, pnlAccum: 0 };
        const delta = event.tradeValue * state.config.pointsPerTradeValue
          + event.pnl * state.config.pointsPerPnl;
        const isWin = event.pnl > 0;
        const isLoss = event.pnl < 0;
        return {
          ...state,
          players: {
            ...state.players,
            [event.player]: {
              gamePoints: Math.max(0, p.gamePoints + delta),
              claims: p.claims + 1,
              lastClaimAt: event.at,
              tradeValue: p.tradeValue + event.tradeValue,
              wins: p.wins + (isWin ? 1 : 0),
              losses: p.losses + (isLoss ? 1 : 0),
              pnlAccum: p.pnlAccum + event.pnl / 100, // Convert back from integer
            },
          },
        };
      }
      case 'ended':
        return { ...state, over: true };
    }
  },

  publicView(state): PublicView {
    return {
      opensAt: state.opensAt,
      endsAt: state.endsAt,
      over: state.over,
      standings: Object.entries(state.players)
        .map(([player, p]) => ({
          player,
          gamePoints: p.gamePoints,
          dollars: Math.floor(p.gamePoints * 0.001 * 100) / 100,
          winRate: p.wins + p.losses > 0 ? Math.round((p.wins / (p.wins + p.losses)) * 100) : 0,
        }))
        .sort((a, b) => b.dollars - a.dollars || a.player.localeCompare(b.player)),
    };
  },

  playerView(state, player): PlayerView {
    const you = state.players[player];
    const cap = state.config.maxTradeValue * state.config.pointsPerTradeValue
      + state.config.maxPnl * state.config.pointsPerPnl;
    return {
      playing: you !== undefined,
      gamePoints: you?.gamePoints ?? 0,
      pointsRemaining: Math.max(0, cap - (you?.gamePoints ?? 0)),
      cooldownUntil: (you?.lastClaimAt ?? 0) + state.config.minMsBetweenClaims,
      dollars: Math.floor((you?.gamePoints ?? 0) * 0.001 * 100) / 100,
      winRate: you ? (you.wins + you.losses > 0 ? Math.round((you.wins / (you.wins + you.losses)) * 100) : 0) : 0,
    };
  },

  nextWakeAt(state) {
    return state.over ? null : state.endsAt;
  },

  rewardBounds(config) {
    // The game's own honest cap: max trade value plus max net P&L.
    return {
      maxPointsPerPlayer: Math.floor(
        config.maxTradeValue * config.pointsPerTradeValue + config.maxPnl * config.pointsPerPnl,
      ),
    };
  },
});

export interface PublicView {
  opensAt: number;
  endsAt: number;
  over: boolean;
  standings: { player: PlayerId; gamePoints: number; dollars: number; winRate: number }[];
}

export interface PlayerView {
  playing: boolean;
  gamePoints: number;
  pointsRemaining: number;
  cooldownUntil: number;
  dollars: number;
  winRate: number;
}