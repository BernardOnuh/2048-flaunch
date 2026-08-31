import { describe, expect, it } from 'vitest';
import { Round } from '@flayerlabs/gamemode-spec/round';
import type { Command } from '@flayerlabs/gamemode-spec';
import { rules, type Config } from '../src/game/rules';

const config: Config = {
  pointsPerSecond: 5,
  pointsPerGreen: 20,
  maxSeconds: 300,
  maxGreens: 60,
  maxGapMs: 10_000,
  minMsBetweenClaims: 1_000,
};

const window = { opensAt: 1_000_000, closesAt: 1_100_000 };
const seed = 11;
const PLAYER = '0xrunner';

function fresh() {
  return Round.start(rules, config, seed, window);
}

type Claim = { kind: 'claim'; seconds: number; greens: number };
const claimAt = (seconds: number, greens: number, at: number): Command<Claim> =>
  ({ kind: 'action', player: PLAYER, action: { kind: 'claim', seconds, greens }, at });

describe('candledodger rules', () => {
  it('awards survival seconds and green candles as allocation points', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    r.send(claimAt(1, 0, window.opensAt + 10)); // survive 1s, no green
    expect(r.pointsFor(PLAYER)).toBe(5);
    r.send(claimAt(2, 1, window.opensAt + 1_150)); // survive 2s, catch 1 green
    expect(r.pointsFor(PLAYER)).toBe(5 + 2 * 5 + 20);
  });

  it('refuses a claim before the window opens', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    const res = r.send(claimAt(1, 0, window.opensAt - 100));
    expect(res).toEqual({ refuse: 'game.not_open' });
    expect(r.pointsFor(PLAYER)).toBe(0);
  });

  it('refuses claims faster than the cooldown', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    r.send(claimAt(1, 0, window.opensAt + 10));
    const tooFast = r.send(claimAt(1, 0, window.opensAt + 500)); // under 1s
    expect(tooFast).toEqual({ refuse: 'claim.too_fast' });
    expect(r.pointsFor(PLAYER)).toBe(5);
    const ok = r.send(claimAt(1, 0, window.opensAt + 1_150));
    expect(ok).not.toHaveProperty('refuse');
    expect(r.pointsFor(PLAYER)).toBe(10);
  });

  it('rejects malformed and oversized actions at parse time', () => {
    expect(rules.parseAction({ kind: 'claim', seconds: -1, greens: 0 })).toBeNull();
    expect(rules.parseAction({ kind: 'claim', seconds: 1.5, greens: 0 })).toBeNull();
    expect(rules.parseAction({ kind: 'claim', seconds: 61, greens: 0 })).toBeNull();
    expect(rules.parseAction({ kind: 'claim', seconds: 1, greens: 4 })).toBeNull(); // > 3/claim
    expect(rules.parseAction({ kind: 'jump', seconds: 1, greens: 0 })).toBeNull();
    expect(rules.parseAction({ kind: 'claim', seconds: 1 })).toBeNull();
    expect(rules.parseAction('nope')).toBeNull();
    expect(rules.parseAction({ kind: 'claim', seconds: 2, greens: 1 })).toEqual({ kind: 'claim', seconds: 2, greens: 1 });
  });

  it('refuses a single claim that represents too much wall time', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    const res = r.send(claimAt(11, 0, window.opensAt + 12_000)); // 11s > maxGapMs 10s
    expect(res).toEqual({ refuse: 'action.too_big' });
    expect(r.pointsFor(PLAYER)).toBe(0);
  });

  it('clamps at the round ceiling and earns exactly the ceiling', () => {
    const cap = config.maxSeconds * config.pointsPerSecond + config.maxGreens * config.pointsPerGreen; // 2700
    expect(rules.rewardBounds(config).maxPointsPerPlayer).toBe(cap);
    // A wide round window so all survival + green claims fit before closesAt.
    const wide = { opensAt: 1_000_000, closesAt: 1_500_000 };
    const r = Round.start(rules, config, seed, wide);
    r.send({ kind: 'join', player: PLAYER, seed, at: wide.opensAt });
    // bank all survival seconds (300 claims of 1s) then all greens, strictly increasing in time
    for (let i = 0; i < config.maxSeconds + config.maxGreens; i++) {
      const isGreen = i >= config.maxSeconds;
      r.send(claimAt(isGreen ? 0 : 1, isGreen ? 1 : 0, wide.opensAt + 10 + i * 1_100));
    }
    expect(r.pointsFor(PLAYER)).toBe(cap);
    const overshoot = r.send(claimAt(0, 1, wide.opensAt + 1_100 * (config.maxSeconds + config.maxGreens + 10)));
    expect(overshoot).toEqual({ refuse: 'claim.cap_reached' });
  });

  it('rejects an empty claim and ends on wake', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    const empty = r.send(claimAt(0, 0, window.opensAt + 10));
    expect(empty).toEqual({ refuse: 'claim.nothing_scored' });
    expect(r.advanceTo(window.closesAt)).toBeGreaterThan(0);
    const res = r.send(claimAt(1, 0, window.closesAt + 1));
    expect(res).toEqual({ refuse: 'game.round_over' });
    expect(r.pointsFor(PLAYER)).toBe(0);
  });

  it('replaying the same commands yields the same state (determinism)', () => {
    const a = fresh();
    const b = fresh();
    const cmds: Command<Claim>[] = [
      { kind: 'join', player: PLAYER, seed, at: window.opensAt + 5 },
      claimAt(1, 0, window.opensAt + 100),
      claimAt(2, 1, window.opensAt + 1_150),
      claimAt(3, 2, window.opensAt + 2_400),
    ];
    for (const c of cmds) { a.send(c); b.send(c); }
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.pointsFor(PLAYER)).toBe(5 + 2 * 5 + 20 + 3 * 5 + 40);
  });
});
