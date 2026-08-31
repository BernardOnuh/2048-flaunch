import { defineGame, type Decision, type PlayerId, type Refusal } from '@flayerlabs/gamemode-spec';

/**
 * Candle Dodger as a Game Mode — survival + green-candle rules (bounded-claim shape).
 *
 * The runner (dodge / collect collisions) runs in the browser and cannot be trusted, so the
 * rules never re-simulate the run. What CAN be bounded is the claim rhythm and the ceiling:
 *
 *  - A claim reports how far the player survived since their last tick and how many green
 *    candles they caught. Both award immediately because the run is public on screen — there
 *    is no hidden beat to leak.
 *  - Survival seconds are rate-limited by `minMsBetweenClaims` (the browser cannot report
 *    faster than real time) and each single claim can never represent more than `maxGapMs`
 *    of play. The cumulative cap `maxSeconds` stops any total above the round's playable span.
 *  - Green candles are bounded per claim by `maxGreensPerClaim` and in total by `maxGreens`,
 *    the number of green candles the round can actually spawn.
 *
 * A cheater with a console can claim, but never faster than the game can be played, never
 * more play per claim than the gap allows, and never past the round ceiling.
 */

export interface Config {
  /** Allocation points per whole second survived. */
  pointsPerSecond: number;
  /** Allocation points per green candle caught. */
  pointsPerGreen: number;
  /** Max survival seconds a player can bank in the round (the survivable span). */
  maxSeconds: number;
  /** Total green candles the round can spawn (the bound per player). */
  maxGreens: number;
  /** A single claim may represent at most this much wall time. */
  maxGapMs: number;
  /** The fastest honest rhythm between claims, measured by play: ~1s. */
  minMsBetweenClaims: number;
}

export interface State {
  config: Config;
  opensAt: number;
  endsAt: number;
  over: boolean;
  players: Record<PlayerId, { gamePoints: number; claims: number; lastClaimAt: number; seconds: number; greens: number }>;
}

/**
 * A claim of progress since the last tick.
 *  - `seconds` is whole seconds survived in wall time (0..maxGapMs/1000).
 *  - `greens` is how many green candles were caught on those moves (0..maxGreensPerClaim).
 * The browser screens collisions and only sends the honest numbers; the rules bound the rate.
 */
export type Action = { kind: 'claim'; seconds: number; greens: number };

export type Event =
  | { t: 'joined'; player: PlayerId }
  | { t: 'claimed'; player: PlayerId; seconds: number; greens: number; at: number }
  | { t: 'ended' };

const MAX_GREENS_PER_CLAIM = 3;

export const rules = defineGame<Config, State, Event, Action, PublicView, PlayerView>({
  id: 'candledodger',

  parseAction(input): Action | null {
    if (typeof input !== 'object' || input === null) return null;
    const keys = Object.keys(input).sort().join(',');
    if (keys !== 'greens,kind,seconds') return null;
    const { kind, seconds, greens } = input as { kind?: unknown; seconds?: unknown; greens?: unknown };
    if (kind !== 'claim') return null;
    if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 0 || seconds > 60) return null;
    if (typeof greens !== 'number' || !Number.isInteger(greens) || greens < 0 || greens > MAX_GREENS_PER_CLAIM) return null;
    return { kind, seconds, greens };
  },

  initRound(config, seed, window) {
    void seed; // the candle layout is visual in the browser; the rules bound claims, not re-simulate
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
        const sec = command.action.seconds;
        const greens = command.action.greens;
        if (sec <= 0 && greens <= 0) return { refuse: 'claim.nothing_scored' };
        // A single claim can never represent more wall time than the gap allows.
        if (sec * 1000 > state.config.maxGapMs) return { refuse: 'action.too_big' };
        // Survival can't bank past the round's survivable span.
        const secondsLeft = Math.max(0, state.config.maxSeconds - player.seconds);
        const secondsGranted = Math.min(sec, secondsLeft);
        const cap = state.config.maxSeconds * state.config.pointsPerSecond
          + state.config.maxGreens * state.config.pointsPerGreen;
        const gamePointsNow = player.gamePoints
          + secondsGranted * state.config.pointsPerSecond
          + greens * state.config.pointsPerGreen;
        if (gamePointsNow > cap) return { refuse: 'claim.cap_reached' };
        if (secondsGranted <= 0 && greens <= 0) return { refuse: 'claim.nothing_scored' };
        return {
          events: [{ t: 'claimed', player: command.player, seconds: secondsGranted, greens, at: command.at }],
          awards: [{
            player: command.player,
            points: secondsGranted * state.config.pointsPerSecond + greens * state.config.pointsPerGreen,
          }],
        };
      }
    }
  },

  evolve(state, event) {
    switch (event.t) {
      case 'joined':
        return {
          ...state,
          players: { ...state.players, [event.player]: { gamePoints: 0, claims: 0, lastClaimAt: 0, seconds: 0, greens: 0 } },
        };
      case 'claimed': {
        const p = state.players[event.player] ?? { gamePoints: 0, claims: 0, lastClaimAt: 0, seconds: 0, greens: 0 };
        return {
          ...state,
          players: {
            ...state.players,
            [event.player]: {
              gamePoints: p.gamePoints + event.seconds * state.config.pointsPerSecond + event.greens * state.config.pointsPerGreen,
              claims: p.claims + 1,
              lastClaimAt: event.at,
              seconds: p.seconds + event.seconds,
              greens: p.greens + event.greens,
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
        }))
        .sort((a, b) => b.dollars - a.dollars || a.player.localeCompare(b.player)),
    };
  },

  playerView(state, player): PlayerView {
    const you = state.players[player];
    const cap = state.config.maxSeconds * state.config.pointsPerSecond
      + state.config.maxGreens * state.config.pointsPerGreen;
    return {
      playing: you !== undefined,
      gamePoints: you?.gamePoints ?? 0,
      pointsRemaining: Math.max(0, cap - (you?.gamePoints ?? 0)),
      cooldownUntil: (you?.lastClaimAt ?? 0) + state.config.minMsBetweenClaims,
      dollars: Math.floor((you?.gamePoints ?? 0) * 0.001 * 100) / 100,
    };
  },

  nextWakeAt(state) {
    return state.over ? null : state.endsAt;
  },

  rewardBounds(config) {
    // The game's own honest cap: survive the full span and catch every green candle.
    return {
      maxPointsPerPlayer: Math.floor(
        config.maxSeconds * config.pointsPerSecond + config.maxGreens * config.pointsPerGreen,
      ),
    };
  },
});

export interface PublicView {
  opensAt: number;
  endsAt: number;
  over: boolean;
  standings: { player: PlayerId; gamePoints: number; dollars: number }[];
}

export interface PlayerView {
  playing: boolean;
  gamePoints: number;
  pointsRemaining: number;
  cooldownUntil: number;
  dollars: number;
}
