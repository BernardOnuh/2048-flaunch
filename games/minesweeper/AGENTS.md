# Build a Flaunch Game Mode

This repository contains a game that awards points during a Flaunch token launch. The game can use
any presentation or control scheme. The server rules decide which actions earn points.

Use `$build-game-mode` when the skill is available. It gives you the safest order for changing the
rules, tests and browser game.

## Know what runs where

The project starts with these files:

```text
src/game/rules.ts   pure server rules and scoring
src/play.ts         browser game and room subscriptions
test/rules.test.ts  replay, scoring and secrecy checks
```

The browser proposes actions. It never awards points.

The gate runs `src/game/rules.ts` and stores every accepted event. A replay of the same commands
must always produce the same state and score.

## Use the development loop

Run these commands:

```bash
pnpm dev
pnpm test
pnpm typecheck
```

`pnpm dev` runs the real rules in a local mock room. It needs no chain, server or wallet.

`pnpm test` runs the rules check and game tests. `pnpm typecheck` checks the whole project. Both
must pass before you finish.

The scaffold does not include a live gate. Add `dev:live` only when you have a real gate harness to
run. Follow the [live gate guide](https://github.com/flayerlabs/gamemode-sdk/blob/main/docs/guides/run-a-gate.md)
instead of inventing a second protocol.

## Keep the rules deterministic

Keep `decide()` and `evolve()` pure.

Do not use these values or operations in the rules module:

- a process or device clock
- random values that do not come from the supplied seed
- network, file or database access
- environment variables
- mutable module-level state

Time arrives as `command.at`. Player randomness arrives as a join seed. Derive any game variation
from those values.

`gamemode check` catches common nondeterministic calls, Node imports and module-level `let` or
`var`. It is a guard, not a proof. Keep replay tests for every scoring path.

## Treat every action as untrusted

`room.send(action)` proposes an action. `decide()` accepts or refuses it.

Do not send a score, hit, kill or trusted timestamp from the browser. Send the smallest input the
server needs to verify the result.

For a shooter, send bounded movement, aim and fire input. The rules should enforce sequence,
cooldown, ammunition and hit logic. The browser may predict and animate at its own frame rate.

Use `parseAction()` to reject malformed and oversized values before `decide()` sees them. Use game
state in `decide()` to enforce limits such as one answer, one shot or one batch at a time.

## Keep private state out of public types

`publicView()` goes to every player and spectator. `playerView()` goes to one player.

If a value must stay private, leave it out of the `publicView()` return type. Do not return it and
filter it later.

For example, keep a quiz answer out of the public type until the reveal. Add a test that serialises
the public view and proves the secret is absent.

## Choose when to award points

Award points when the result should become known.

An arrow score can be public as soon as the arrow lands. Award it with the accepted action.

A quiz answer should stay private until the reveal. Store the answer event first. Award points from
the later wake that reveals the result. Otherwise the player's allowance exposes the answer early.

## Keep wallets outside the game

Creator code must not access a wallet, private key, RPC endpoint or transaction calldata.

Use the room economy:

```ts
await room.economy.buy(maxSpendWei)
```

The trusted parent validates the gate authorisation, builds the transaction and asks the player to
approve it. Game code never handles `hookData`.

## Declare the maximum score

`rewardBounds(config)` must return the highest score one player can earn.

Derive the number from the rules. For example, multiply the shot budget by the best shot, or add
the points for every question.

Do not use an estimate. The platform uses this bound to check the launch wallet cap. Points above
an understated bound cannot become spending allowance.

## Build fixed timelines once

Use `scheduleWithin()` for a fixed series of phases:

```ts
import { scheduleWithin } from '@flayerlabs/gamemode-spec/schedule'
```

It checks that the full schedule fits between `opensAt` and `closesAt`. It also gives each phase an
absolute time, so a delayed server wake does not move every later phase.

Every `nextWakeAt()` value must be later than the wake being served. Return `null` when the game has
no more timed work.

## Model readiness as a game rule

Presence tells you how many players are connected. It does not start the game.

If players must ready up, define a ready action and store it in game state:

```ts
{ kind: 'ready', ready: true }
```

This lets `decide()` apply the rule. It also makes readiness replayable after a restart.

## Use the module contract

Implement the complete rules module:

```ts
export const rules = defineGame<Config, State, Event, Action, PublicView, PlayerView>({
  id: 'my-game',
  parseAction,
  initRound,
  decide,
  evolve,
  publicView,
  playerView,
  nextWakeAt,
  rewardBounds,
})
```

Commands reaching `decide()` are `join`, `leave`, `action` and `wake`. Each command includes the
authoritative `at` time.

A decision returns events and may return awards. `evolve()` applies events in order. A refusal
returns a stable code:

```ts
return { refuse: 'answer.window_closed' }
```

Do not rename a refusal code after use. Add a new code. Keep player-facing copy in the browser.

## Use the room capabilities

The browser uses this surface:

```ts
room.subscribe(render)
await room.send(action)
room.now()

room.launch.current()
room.connection.subscribe(renderConnection)
room.economy.subscribe(renderEconomy)
room.economy.buy(maxSpendWei)
room.market.subscribe(renderMarket)
await room.identity.resolve(playerIds)
room.presence.subscribe(renderPresence)
room.social.react(id)
room.social.onReaction(renderReaction)
```

Use `room.now()` for every visible timer. Do not use `Date.now()` in a countdown.

The local mock implements the same room surface. Build against it before adding live
infrastructure.

## Finish with evidence

Before you finish, check that:

- correct play earns the expected points
- invalid and repeated actions are refused
- action sizes and rates are bounded
- public views contain no secrets
- private views contain only that player's data
- delayed wakes keep the authored schedule
- replaying the same commands gives the same result
- `rewardBounds()` matches the best possible score
- `pnpm test` passes
- `pnpm typecheck` passes

If the SDK contract does not fit the game, stop and explain the missing capability. Do not bypass a
trust boundary in browser code.
