import { describe, expect, it } from 'vitest';
import { Round } from '@flayerlabs/gamemode-spec/round';
import type { Command } from '@flayerlabs/gamemode-spec';
import { rules, type Config } from '../src/game/rules';

const config: Config = {
  pointsPerTradeValue: 1,
  pointsPerPnl: 10,
  maxTradeValue: 50000,
  maxPnl: 1000,
  maxClaimTradeValue: 1000,
  minMsBetweenClaims: 1_000,
};

const window = { opensAt: 1_000_000, closesAt: 1_100_000 };
const seed = 11;
const PLAYER = '0xrunner';

function fresh() {
  return Round.start(rules, config, seed, window);
}

type Claim = { kind: 'claim'; seconds: number; greens: number; reds: number };
const claimAt = (seconds: number, greens: number, reds: number, at: number): Command<Claim> =>
  ({ kind: 'action', player: PLAYER, action: { kind: 'claim', seconds, greens, reds }, at });

describe('candledodger rules', () => {
  it('awards trade value and net P&L', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    r.send(claimAt(100, 0, 1, window.opensAt + 10)); // trade value 100
    expect(r.pointsFor(PLAYER)).toBe(100); // 100 * 1 = 100
    r.send(claimAt(200, 500, 2, window.opensAt + 1_150)); // +200 value, +500 pnl
    expect(r.pointsFor(PLAYER)).toBe(100 + 200 + 5000); // 5300
  });

  it('lets a losing trade reduce the net P&L while allocation stays monotonic', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    r.send(claimAt(100, 200, 1, window.opensAt + 10)); // +100 + 2000 = 2100
    expect(r.pointsFor(PLAYER)).toBe(2100);
    // a claim with a loss cannot go negative
    r.send(claimAt(0, -300, 2, window.opensAt + 1_150)); // -3000 → net -900, floored at 0
    r.send(claimAt(0, -100, 1, window.opensAt + 2_250)); // floored at 0
    expect(r.pointsFor(PLAYER)).toBe(2100); // SDK only ever accumulates non-negative awards
  });

  it('refuses a claim before the window opens', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    const res = r.send(claimAt(100, 0, 1, window.opensAt - 100));
    expect(res).toEqual({ refuse: 'game.not_open' });
    expect(r.pointsFor(PLAYER)).toBe(0);
  });

  it('refuses claims faster than the cooldown', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    r.send(claimAt(100, 0, 1, window.opensAt + 10));
    const tooFast = r.send(claimAt(100, 0, 1, window.opensAt + 500)); // under 1s
    expect(tooFast).toEqual({ refuse: 'claim.too_fast' });
    expect(r.pointsFor(PLAYER)).toBe(100);
    const ok = r.send(claimAt(100, 0, 1, window.opensAt + 1_150));
    expect(ok).not.toHaveProperty('refuse');
    expect(r.pointsFor(PLAYER)).toBe(200);
  });

  it('rejects malformed and oversized actions at parse time', () => {
    expect(rules.parseAction({ kind: 'claim', seconds: -1, greens: 0, reds: 0 })).toBeNull();
    expect(rules.parseAction({ kind: 'claim', seconds: 1.5, greens: 0, reds: 0 })).toBeNull();
    expect(rules.parseAction({ kind: 'claim', seconds: 100001, greens: 0, reds: 0 })).toBeNull();
    expect(rules.parseAction({ kind: 'claim', seconds: 1, greens: 10001, reds: 0 })).toBeNull();
    expect(rules.parseAction({ kind: 'claim', seconds: 1, greens: 0, reds: 11 })).toBeNull();
    expect(rules.parseAction({ kind: 'claim', seconds: 1, greens: 0 })).toBeNull();
    expect(rules.parseAction({ kind: 'jump', seconds: 1, greens: 0, reds: 0 })).toBeNull();
    expect(rules.parseAction('nope')).toBeNull();
    expect(rules.parseAction({ kind: 'claim', seconds: 2, greens: 1, reds: 1 })).toEqual({ kind: 'claim', seconds: 2, greens: 1, reds: 1 });
  });

  it('refuses a single claim that represents too much trade value', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    const res = r.send(claimAt(1001, 0, 1, window.opensAt + 10)); // 1001 > maxClaimTradeValue 1000
    expect(res).toEqual({ refuse: 'action.too_big' });
    expect(r.pointsFor(PLAYER)).toBe(0);
  });

  it('clamps at the round ceiling and earns exactly the ceiling', () => {
    const cap = config.maxTradeValue * config.pointsPerTradeValue + config.maxPnl * config.pointsPerPnl;
    expect(rules.rewardBounds(config).maxPointsPerPlayer).toBe(cap);
    // A wide round window so all trade claims fit before closesAt.
    const wide = { opensAt: 1_000_000, closesAt: 1_500_000 };
    const r = Round.start(rules, config, seed, wide);
    r.send({ kind: 'join', player: PLAYER, seed, at: wide.opensAt });
    // bank all trade value (50 claims of 1000) then all pnl, strictly increasing in time
    for (let i = 0; i < 50; i++) {
      r.send(claimAt(1000, 0, 1, wide.opensAt + 10 + i * 1_100));
    }
    for (let i = 0; i < config.maxPnl / 100; i++) {
      r.send(claimAt(0, 100, 1, wide.opensAt + 10 + (50 + i) * 1_100));
    }
    expect(r.pointsFor(PLAYER)).toBe(cap);
    const overshoot = r.send(claimAt(0, 100, 1, wide.opensAt + 1_100 * (50 + config.maxPnl / 100 + 10)));
    expect(overshoot).toEqual({ refuse: 'claim.cap_reached' });
  });

  it('rejects an empty claim and ends on wake', () => {
    const r = fresh();
    r.send({ kind: 'join', player: PLAYER, seed, at: window.opensAt });
    const empty = r.send(claimAt(0, 0, 0, window.opensAt + 10));
    expect(empty).toEqual({ refuse: 'claim.nothing_scored' });
    expect(r.advanceTo(window.closesAt)).toBeGreaterThan(0);
    const res = r.send(claimAt(100, 0, 1, window.closesAt + 1));
    expect(res).toEqual({ refuse: 'game.round_over' });
    expect(r.pointsFor(PLAYER)).toBe(0);
  });

  it('replaying the same commands yields the same state (determinism)', () => {
    const a = fresh();
    const b = fresh();
    const cmds: Command<Claim>[] = [
      { kind: 'join', player: PLAYER, seed, at: window.opensAt + 5 },
      claimAt(100, 0, 1, window.opensAt + 100),
      claimAt(200, 500, 2, window.opensAt + 1_150),
      claimAt(300, -100, 1, window.opensAt + 2_400),
    ];
    for (const c of cmds) { a.send(c); b.send(c); }
    expect(a.snapshot()).toEqual(b.snapshot());
    // +100 + (200 + 5000) = 5300; the last claim is a net loss so it adds no points
    // (awarded points never ratchet down — the SDK only accumulates non-negative awards).
    expect(a.pointsFor(PLAYER)).toBe(5300);
  });
});