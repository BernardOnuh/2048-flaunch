import { describe, expect, it } from 'vitest';
import { Round } from '@flayerlabs/gamemode-spec/round';
import type { Command } from '@flayerlabs/gamemode-spec';
import { rules, type Config } from '../src/game/rules';

const config: Config = {
  pointsPerGamePoint: 1,
  safeCellsPerBoard: 216, // 16×16 / 40 mines
  maxBoards: 8,
  minMsBetweenClaims: 1_500,
};

const window = { opensAt: 1_000_000, closesAt: 1_100_000 };
const seed = 7;
const PLAYER = '0xmine';

function fresh() {
  return Round.start(rules, config, seed, window);
}

type Reveal = { kind: 'reveal'; cells: number };
const cell = (at: number): Command<Reveal> => ({ kind: 'action', player: PLAYER, action: { kind: 'reveal', cells: 1 }, at });
const ncell = (n: number, at: number): Command<Reveal> => ({ kind: 'action', player: PLAYER, action: { kind: 'reveal', cells: n }, at });

describe('minesweeper rules', () => {
  it('awards revealed safe cells as allocation points', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    r.send(ncell(1, window.opensAt + 10)); // a numbered cell
    expect(r.pointsFor(PLAYER)).toBe(1);
    r.send(ncell(24, window.opensAt + 2_010)); // an empty-cell flood-fill
    expect(r.pointsFor(PLAYER)).toBe(25);
  });

  it('refuses a claim before the window opens', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    const res = r.send(ncell(4, window.opensAt - 100));
    expect(res).toEqual({ refuse: 'game.not_open' });
    expect(r.pointsFor(PLAYER)).toBe(0);
  });

  it('refuses reveals faster than the click cooldown', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    r.send(cell(window.opensAt + 10));
    const tooFast = r.send(cell(window.opensAt + 1_000)); // under 1.5s
    expect(tooFast).toEqual({ refuse: 'claim.too_fast' });
    expect(r.pointsFor(PLAYER)).toBe(1);
    const ok = r.send(cell(window.opensAt + 2_010));
    expect(ok).not.toHaveProperty('refuse');
    expect(r.pointsFor(PLAYER)).toBe(2);
  });

  it('rejects malformed and oversized actions at parse time', () => {
    expect(rules.parseAction({ kind: 'reveal', cells: -1 })).toBeNull();
    expect(rules.parseAction({ kind: 'reveal', cells: 1.5 })).toBeNull();
    expect(rules.parseAction({ kind: 'flag', cells: 1 })).toBeNull();
    expect(rules.parseAction({ kind: 'reveal' })).toBeNull();
    expect(rules.parseAction({ kind: 'reveal', cells: 3, extra: 1 })).toBeNull();
    expect(rules.parseAction('nope')).toBeNull();
    expect(rules.parseAction({ kind: 'reveal', cells: 9 })).toEqual({ kind: 'reveal', cells: 9 });
  });

  it('refuses a click larger than one board can open', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    const res = r.send(ncell(300, window.opensAt + 10)); // > 216 safe cells
    expect(res).toEqual({ refuse: 'action.too_big' });
    expect(r.pointsFor(PLAYER)).toBe(0);
  });

  it('clamps at the round ceiling and earns exactly the ceiling', () => {
    const cap = config.safeCellsPerBoard * config.maxBoards; // 1728
    expect(rules.rewardBounds(config).maxPointsPerPlayer).toBe(cap);
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    // reveal 216 per click (an entire board) across 8 boards, plus an over-shot
    for (let i = 0; i < 9; i++) {
      r.send(ncell(216, window.opensAt + 10 + i * 2_010));
    }
    expect(r.pointsFor(PLAYER)).toBe(cap); // clamped, never above the ceiling
    const capHit = r.send(ncell(216, window.opensAt + 10 + 9 * 2_010));
    expect(capHit).toEqual({ refuse: 'claim.cap_reached' });
  });

  it('rejects unknown command kinds gracefully and ends on wake', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    expect(r.advanceTo(window.closesAt)).toBeGreaterThan(0);
    const res = r.send({ kind: 'action', player: PLAYER, action: { kind: 'reveal', cells: 1 }, at: window.closesAt + 1 });
    expect(res).toEqual({ refuse: 'game.round_over' });
    expect(r.pointsFor(PLAYER)).toBe(0);
  });

  it('replaying the same commands yields the same state (determinism)', () => {
    const a = fresh();
    const b = fresh();
    const cmds: Command<Reveal>[] = [
      { kind: 'join', player: PLAYER, seed, at: window.opensAt + 5 },
      ncell(1, window.opensAt + 100),
      ncell(9, window.opensAt + 2_100),
      ncell(24, window.opensAt + 4_100),
    ];
    for (const c of cmds) { a.send(c); b.send(c); }
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.pointsFor(PLAYER)).toBe(34);
  });
});
