import { defineGame, type Decision, type PlayerId, type Refusal } from '@flayerlabs/gamemode-spec';

/**
 * <GAME NAME> as a Game Mode — claims-based rules (immediate-award shape).
 *
 * The game's physics run in the browser and cannot be trusted. What CAN be bounded is the
 * claim rate: a scoring event is a proposal, and these rules only pay for a rhythm of claims
 * honest play allows. A cheater with a console open can claim, but never faster than
 * `minMsBetweenClaims`, never more than `maxClaimPoints` at once, never past `maxGamePoints`.
 *
 * Immediate awards fit scores that are public the moment they land (a basket, a landed
 * arrow). If your game has a reveal beat, split accept and award instead — an early balance
 * change would leak the result. See references/patterns.md.
 */

export interface Config {
  /** Allocation points per game point (mock rate: 1 point = $1). */
  pointsPerGamePoint: number;
  /** The game's OWN score ceiling — never an invented one. */
  maxGamePoints: number;
  /** The fastest honest rhythm between scoring events, measured by playing. */
  minMsBetweenClaims: number;
  /** The most a single claim can be worth (e.g. 3 for a basketball 3-pointer). */
  maxClaimPoints: number;
}

export interface State {
  config: Config;
  opensAt: number;
  endsAt: number;
  over: boolean;
  players: Record<PlayerId, { gamePoints: number; claims: number; lastClaimAt: number }>;
}

/** TODO: name this after the game's own scoring event ({ basket: 2|3 }, { lap: 1 }, …). */
export type Action = { claim: number };

export type Event =
  | { t: 'joined'; player: PlayerId }
  | { t: 'claimed'; player: PlayerId; points: number; at: number }
  | { t: 'ended' };

export const rules = defineGame<Config, State, Event, Action, PublicView, PlayerView>({
  id: '<game-id>', // stable, unique across games

  parseAction(input): Action | null {
    if (typeof input !== 'object' || input === null) return null;
    if (Object.keys(input).length !== 1) return null;
    const { claim } = input as { claim?: unknown };
    // Malformed AND oversized both die here, before decide sees them.
    if (typeof claim === 'number' && Number.isInteger(claim) && claim >= 1 && claim <= 64) {
      return { claim };
    }
    return null;
  },

  initRound(config, seed, window) {
    void seed; // any randomness the game needs must be DERIVED from this seed, nothing ambient
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
        if (command.action.claim > state.config.maxClaimPoints) return { refuse: 'claim.too_big' };
        if (command.at - player.lastClaimAt < state.config.minMsBetweenClaims) {
          return { refuse: 'claim.too_fast' };
        }
        // Clamp at the ceiling rather than refuse partway: the points that reach the cap
        // still pay, nothing beyond the declared ceiling ever does.
        const granted = Math.min(command.action.claim, state.config.maxGamePoints - player.gamePoints);
        if (granted <= 0) return { refuse: 'claim.cap_reached' };
        return {
          events: [{ t: 'claimed', player: command.player, points: granted, at: command.at }],
          awards: [{ player: command.player, points: granted * state.config.pointsPerGamePoint }],
        };
      }
    }
  },

  evolve(state, event) {
    switch (event.t) {
      case 'joined':
        return {
          ...state,
          players: { ...state.players, [event.player]: { gamePoints: 0, claims: 0, lastClaimAt: 0 } },
        };
      case 'claimed': {
        const p = state.players[event.player] ?? { gamePoints: 0, claims: 0, lastClaimAt: 0 };
        return {
          ...state,
          players: {
            ...state.players,
            [event.player]: {
              gamePoints: p.gamePoints + event.points,
              claims: p.claims + 1,
              lastClaimAt: event.at,
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
          dollars: p.gamePoints * state.config.pointsPerGamePoint,
        }))
        .sort((a, b) => b.dollars - a.dollars || a.player.localeCompare(b.player)),
    };
  },

  playerView(state, player): PlayerView {
    const you = state.players[player];
    return {
      playing: you !== undefined,
      gamePoints: you?.gamePoints ?? 0,
      pointsRemaining: Math.max(0, state.config.maxGamePoints - (you?.gamePoints ?? 0)),
      cooldownUntil: (you?.lastClaimAt ?? 0) + state.config.minMsBetweenClaims,
      score: (you?.gamePoints ?? 0) * state.config.pointsPerGamePoint,
    };
  },

  nextWakeAt(state) {
    return state.over ? null : state.endsAt;
  },

  rewardBounds(config) {
    // The game's own cap is the honest ceiling: a perfect session earns exactly this.
    return { maxPointsPerPlayer: config.maxGamePoints * config.pointsPerGamePoint };
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
  score: number;
}
