# Drugwars 2026 — module contract

Plain script tags share one global scope; load order in index.html is law:
**core → data → game → art → audio → ui**. Globals are the module system. Cross-module
calls use ONLY the names below; additions happen by editing this file.

## Hard rules
- No ES modules, no build, must run from file:// — plain script tags only.
- ALL gameplay randomness goes through `RNG` (seeded mulberry32). `Math.random`
  is allowed only for cosmetics (e.g. `randomSeedWord`, UI flourishes).
- Every engine action that consumes RNG does `RNG.state = s.rng` FIRST and
  `s.rng = RNG.state` LAST (including every early-return path that already
  drew). This is what makes save/resume ≡ straight-through; test/engine.js
  asserts it across ~110 cut points, ~30 of them mid-encounter.
- `G.state` is a plain JSON object. `JSON.stringify(G.state)` IS the save.
  Nothing non-serializable (functions, Sets, class instances) goes in it.
- Actions never throw on bad UI input — they refuse with `{ok:false,msg}`.
- The engine (core/data/game) is headless: no DOM, no timers, no audio.
- Tests: `node test/engine.js && node test/boot.js` — green before merging.
  test/shim.js loads the bundle under a stub DOM; each `load()` is a fresh set
  of globals (fresh RNG closure), so suites can run two instances side by side.

## js/core.js
`RNG {seed(n), state (get/set, int32), next(), range(a,b), int(n), chance(p), pick(arr)}`,
`clamp`, `fmt(n)` → `$1,234` / `-$5`, `fmtK(n)` → `$12.3K/$2.50M/$3.00B`,
`hashSeed(str)` → stable int32 (FNV-1a), `randomSeedWord()` (Math.random — cosmetic),
`el(id)`.

## js/data.js — pure data, nothing computes
`GOODS[8] {k,name,unit,lo,hi,spike,crash}` — index order is the hotkey order.
`DISTRICTS[6] {k,name,blurb,cheap,dear}`, `HOME=0` (bank, loan desk, clinic),
`CHEAP_MULT=0.72`, `DEAR_MULT=1.35`, `RULES` (every tunable, named),
`EVENTS {find,mugged,van,lawyer,feds,quiet,win,escaped,hit,bribe,custody}` copy with
`{placeholders}`, `RANKS [[threshold,title]...]` descending, last is `-Infinity`.

## js/game.js — the engine
`G.state` is the one mutable object. Owner of the state shape:

```
{ v:1, seedWord, seed, day, days, loc, cash, bank, debt, health, trunk, lawyers,
  inv[8], paid[8]            // paid = total cost basis per good (avgPaid = paid/inv)
  prices[8]                  // 0 = not traded here today; else integer ≥ 1
  hist[]                     // {day,loc,prices[]} snapshots for sparklines (≤90)
  event                      // day card: {kind, text, good?, offer?, price?, taken?}
                             // kind ∈ quiet|find|mugged|van|lawyer|spike|crash|feds|hit|clear|over
  encounter                  // null | {agents, start, rounds}
  phase                      // 'market' | 'encounter' | 'over'
  log[] ≤60 {day,text}, stats {bought,sold,profit,escapes,bribes,cases},
  rng                        // RNG.state mirror — the resume key
  result                     // null | {why:'time'|'custody', netWorth, rank, day} }
```

### Lifecycle
- `G.new(seedWord, days)` → state (days clamped to `RULES.daysOptions[0]` if not
  an option). Seeds RNG from `hashSeed(seedWord)`, rolls day-1 prices.
- `G.save()` → JSON string. `G.load(jsonOrObj)` → state or `null` (rejects bad
  JSON, `v!==1`, wrong `inv` length); restores `RNG.state` from `s.rng`.

### Actions — all return `{ok:boolean, msg?:string, over?:true}`
Market phase only: `buy(i,n)`, `sell(i,n)`, `travel(dest)`.
Encounter phase only: `run()`, `lawyerUp()`, `bribe()`.
Any phase (see finding below), HOME only: `deposit(n)`, `withdraw(n)`, `payDebt(n)`,
`borrow(n)`, `heal()`. `acceptOffer()` when `event.offer && !event.taken`.
`n` is floored; `n<=0`/NaN refused. `over:true` appears only on the call that
ended the game (`travel` past the last day, or a `run` that dropped health ≤ 0).

Read-only helpers (take `s`): `used, space, stashValue, netWorth (cash+bank-debt),
maxLoan, bribeCost, canService (loc===HOME), avgPaid(s,i), maxBuy(s,i)`;
`G.rank(nw)` → title; `G._midPrice(i)`.

### Travel = the day turning over
`travel(dest)`: refuse if same loc / out of range / not market. Then day+1,
debt ×(1+loanRate), bank ×(1+bankRate) (both rounded). If `day > days` → `_end('time')`.
Else new prices, then `_arrive` decides ONE of, in priority order:
1. Task Force (only if holding stock; odds from fedsBase/PerDay/PerValue, cap fedsMax) → `phase='encounter'`
2. price event (spike = `hi × spikeMult`, crash = `lo ÷ crashDiv`) — steps outside the band
3. non-price event: find (clipped to trunk space) / mugged (10–25% of cash, if cash>500) / van offer / lawyer offer
4. quiet.

Price band: log-uniform in `[lo,hi]`, × CHEAP_MULT or DEAR_MULT by district, so the
"in band" check is `lo×0.72 .. hi×1.35`; `availMin..availMax` goods trade per day.

### Phase state machine
```
market --travel--> market            (quiet / price / non-price event)
market --travel--> encounter         (feds)
market --travel(day>days)--> over    result.why='time'
encounter --run (escape) / bribe / lawyerUp (agents→0)--> market   (event.kind='clear')
encounter --run (hit, health>0)--> encounter  (event.kind='hit', rounds++)
encounter --run (health≤0)--> over   result.why='custody': cash=0, inv/paid zeroed
over: everything market/encounter refuses ('Not now.')
```

## js/audio.js / js/ui.js
UI owns index.html DOM + css. Reads `G.state` and calls the action API above;
never mutates state directly, never touches RNG. Audio is no-op safe headless
(test/shim.js stubs AudioContext).

## Known engine findings (test/engine.js prints, does not assert)
- `maxLoan = maxLoanMult × (cash+bank)`: borrowing raises cash, so the ceiling
  recedes and repeated max borrows compound without bound ($17.5K → $2.8M in 5 calls).
- Downtown services (`deposit/withdraw/payDebt/borrow/heal`) check `loc` but not
  `phase`: they succeed mid-encounter (heal between failed runs) and after `over`.

## js/art.js — procedural visuals (canvas only, reads state, never mutates, never touches RNG)
`ART.icon(k,size)` cached pixel-art canvas per good key · `ART.map(cv,state,{hover,t,route,car})` the
city map · `ART.mapHit(cv,ev)` → district index or -1 · `ART.spark(cv,vals,lo,hi,cur)` price history ·
`ART.scene(cv,encounter,t,{calm,hit})` the Task Force scene · `ART.gauge(cv,state)` trunk · `ART.bar(cv,frac,col)`.
Cosmetic randomness (map blocks) comes from a fixed local hash so the map is identical every load.
The engine keeps `state.hist` (price snapshots per day, ≤90) purely so sparklines can draw; no RNG involved.
