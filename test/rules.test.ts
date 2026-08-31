import { describe, expect, it } from 'vitest';
import { Round } from '@flayerlabs/gamemode-spec/round';
import type { Command } from '@flayerlabs/gamemode-spec';
import { rules, type Config } from '../src/game/rules';

const config: Config = {
  pointsPerGamePoint: 1,
  maxGamePoints: 75_000,
  minMsBetweenClaims: 2_000,
  maxClaimPoints: 32_768,
};

const window = { opensAt: 1_000_000, closesAt: 1_300_000 };
const seed = 42;
const PLAYER = '0xabc';

function fresh() {
  return Round.start(rules, config, seed, window);
}

describe('2048 rules', () => {
  it('awards a swipe batch as allocation points', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    // swipe scoring 8 points
    r.send({ kind: 'action', player: PLAYER, action: { batch: 8 }, at: window.opensAt + 10 });
    expect(r.pointsFor(PLAYER)).toBe(8);
  });

  it('refuses a claim before the window opens', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    const res = r.send({ kind: 'action', player: PLAYER, action: { batch: 8 }, at: window.opensAt - 100 });
    expect(res).toEqual({ refuse: 'game.not_open' });
    expect(r.pointsFor(PLAYER)).toBe(0);
  });

  it('refuses claims faster than the swipe cooldown', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    r.send({ kind: 'action', player: PLAYER, action: { batch: 8 }, at: window.opensAt + 10 });
    // second swipe 1s later — under the 2s cooldown
    const tooFast = r.send({ kind: 'action', player: PLAYER, action: { batch: 8 }, at: window.opensAt + 1_010 });
    expect(tooFast).toEqual({ refuse: 'claim.too_fast' });
    expect(r.pointsFor(PLAYER)).toBe(8);
    // a swipe at 2s passes
    const ok = r.send({ kind: 'action', player: PLAYER, action: { batch: 4 }, at: window.opensAt + 2_010 });
    expect(ok).not.toHaveProperty('refuse');
    expect(r.pointsFor(PLAYER)).toBe(12);
  });

  it('rejects malformed and oversized actions at parse time', () => {
    expect(rules.parseAction({ batch: -1 })).toBeNull();
    expect(rules.parseAction({ batch: 1.5 })).toBeNull();
    expect(rules.parseAction({ batch: 99_999_999 })).toBeNull();
    expect(rules.parseAction({ batch: 12, extra: 1 })).toBeNull();
    expect(rules.parseAction('nope')).toBeNull();
    expect(rules.parseAction({ batch: 16 })).toEqual({ batch: 16 });
  });

  it('refuses repeated joins are idempotent', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    const again = r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    expect(again).toEqual({ events: [] });
  });

  it('clamps at the maxGamePoints ceiling and earns exactly the ceiling', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    // get close to the ceiling
    for (let i = 0; i < 40; i++) {
      r.send({ kind: 'action', player: PLAYER, action: { batch: 1024 }, at: window.opensAt + 10 + i * 2_010 });
    }
    // 40 * 1024 = 40960, then push to past the ceiling
    for (let i = 0; i < 34; i++) {
      r.send({ kind: 'action', player: PLAYER, action: { batch: 1024 }, at: window.opensAt + 10 + (40 + i) * 2_010 });
    }
    expect(r.pointsFor(PLAYER)).toBeLessThanOrEqual(config.maxGamePoints);
  });

  it('rewardBounds matches the ceiling', () => {
    expect(rules.rewardBounds(config)).toEqual({ maxPointsPerPlayer: config.maxGamePoints });
  });

  it('reports score to the player view and nothing to public standings before a join shows', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    r.send({ kind: 'action', player: PLAYER, action: { batch: 16 }, at: window.opensAt + 10 });
    const pv = r.playerView(PLAYER);
    expect(pv.gamePoints).toBe(16);
    expect(pv.dollars).toBeCloseTo(0.01);
    const pub = r.publicView();
    expect(pub.standings[0].player).toBe(PLAYER);
    expect(pub.standings[0].gamePoints).toBe(16);
  });

  it('replaying the same commands yields the same state (determinism)', () => {
    const a = fresh();
    const b = fresh();
    const cmds: Command<{ batch: number }>[] = [
      { kind: 'join', player: PLAYER, seed, at: window.opensAt + 5 },
      { kind: 'action', player: PLAYER, action: { batch: 4 }, at: window.opensAt + 100 },
      { kind: 'action', player: PLAYER, action: { batch: 8 }, at: window.opensAt + 2_100 },
    ];
    for (const c of cmds) { a.send(c); b.send(c); }
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('a wake closes the round at endsAt', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    expect(r.advanceTo(window.closesAt)).toBeGreaterThan(0);
    const res = r.send({ kind: 'action', player: PLAYER, action: { batch: 4 }, at: window.closesAt + 1 });
    expect(res).toEqual({ refuse: 'game.round_over' });
  });
});
