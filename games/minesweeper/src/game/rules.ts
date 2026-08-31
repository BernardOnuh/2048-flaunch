import { defineGame, type Decision, type PlayerId, type Refusal } from '@flayerlabs/gamemode-spec';

/**
 * Minesweeper as a Game Mode — reveals-based rules (immediate-award shape).
 *
 * The board (mine layout, flood-fill) runs in the browser and cannot be trusted, so the rules
 * never re-simulate a reveal. What CAN be bounded is the reveal rhythm and the ceiling:
 *
 *  - A reveal is public the instant the cell opens on screen, so points award immediately.
 *  - Each claim reports how many safe cells THAT click newly revealed (`cells`): a numbered
 *    cell is 1, an empty cell flood-fills a whole region. Immediate award is correct because
 *    the revealed cells are visible to everyone — there is no hidden beat to leak.
 *  - The launch is a fixed 16×16 / 40-mine board (216 safe cells) repeated for up to
 *    `maxBoards` boards. The honest ceiling = maxBoards × safeCellsPerBoard. A human reveal
 *    click cannot land faster than `minMsBetweenClaims`, and one click can never open more
 *    than `safeCellsPerBoard` (the largest possible flood-fill is the whole safe area).
 *
 * A cheater with a console can claim, but never faster than the game can be clicked, never
 * more than one board's safe cells per click, never past the round ceiling.
 */

export interface Config {
  /** Allocation points per safe cell revealed. 1:1. */
  pointsPerGamePoint: number;
  /** Safe cells on one fixed board (16×16, 40 mines = 216 safe). */
  safeCellsPerBoard: number;
  /** How many boards the launch window offers a player. */
  maxBoards: number;
  /** The fastest honest rhythm between reveal clicks, measured by play: ~1.5s. */
  minMsBetweenClaims: number;
}

export interface State {
  config: Config;
  opensAt: number;
  endsAt: number;
  over: boolean;
  players: Record<PlayerId, { gamePoints: number; claims: number; lastClaimAt: number }>;
}

/**
 * A reveal click's newly-opened safe cells. `cells` is the smallest input the server needs:
 * 1 for a numbered cell, more for an empty-cell flood-fill. The browser screens the mine and
 * only sends safe reveals.
 */
export type Action = { kind: 'reveal'; cells: number };

export type Event =
  | { t: 'joined'; player: PlayerId }
  | { t: 'claimed'; player: PlayerId; points: number; at: number }
  | { t: 'ended' };

export const rules = defineGame<Config, State, Event, Action, PublicView, PlayerView>({
  id: 'minesweeper',

  parseAction(input): Action | null {
    if (typeof input !== 'object' || input === null) return null;
    const keys = Object.keys(input).sort().join(',');
    if (keys !== 'cells,kind') return null;
    const { kind, cells } = input as { kind?: unknown; cells?: unknown };
    if (kind !== 'reveal') return null;
    if (typeof cells === 'number' && Number.isInteger(cells) && cells >= 0) return { kind, cells };
    return null;
  },

  initRound(config, seed, window) {
    void seed; // the board is random in the browser; the rules bound claims, not re-simulate
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
        const cap = state.config.safeCellsPerBoard * state.config.maxBoards;
        if (command.action.cells > state.config.safeCellsPerBoard) return { refuse: 'action.too_big' };
        if (command.at - player.lastClaimAt < state.config.minMsBetweenClaims) {
          return { refuse: 'claim.too_fast' };
        }
        // A click that opened nothing — not a played reveal, but not a player error either.
        if (command.action.cells <= 0) return { refuse: 'claim.nothing_scored' };
        const granted = Math.min(command.action.cells, cap - player.gamePoints);
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
          dollars: Math.floor(p.gamePoints * state.config.pointsPerGamePoint * 0.001 * 100) / 100,
        }))
        .sort((a, b) => b.dollars - a.dollars || a.player.localeCompare(b.player)),
    };
  },

  playerView(state, player): PlayerView {
    const you = state.players[player];
    return {
      playing: you !== undefined,
      gamePoints: you?.gamePoints ?? 0,
      pointsRemaining: Math.max(0, state.config.safeCellsPerBoard * state.config.maxBoards - (you?.gamePoints ?? 0)),
      cooldownUntil: (you?.lastClaimAt ?? 0) + state.config.minMsBetweenClaims,
      dollars: Math.floor((you?.gamePoints ?? 0) * state.config.pointsPerGamePoint * 0.001 * 100) / 100,
    };
  },

  nextWakeAt(state) {
    return state.over ? null : state.endsAt;
  },

  rewardBounds(config) {
    // The game's own honest cap: reveal every safe cell on every board the window offers.
    return {
      maxPointsPerPlayer: Math.floor(config.maxBoards * config.safeCellsPerBoard * config.pointsPerGamePoint),
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
