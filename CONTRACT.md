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
  asserts it across ~150 cut points across all four tiers, some mid-encounter,
  mid-collectors, holding jobs, and with the supplier unlocked.
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
`GOODS[8] {k,heat,name,unit,lo,hi,spike,crash}` — index order is the hotkey order; `heat`
is the good's weight in the heat meter (coke 1.0 … weed 0.3).
`DISTRICTS[6] {k,name,blurb,cheap,dear}`, `HOME=0` (bank, loan desk, clinic),
`CHEAP_MULT=0.72`, `DEAR_MULT=1.35`.
`TIERS[4] {k,name,blurb,cash,debt,rate,fedsMax,vol,cost,trunk,scoreMult,cutCredit}` — index 1
(BLOCK) is the default; the engine reads everything tier-dependent through `G.T(s)`.
`CONTACTS[6] {k,name,role,line,perk}` — one per district, **contact index === district index**
(0 Lorna/Downtown, 1 Vic/Port, 2 Dee/Data Center Row, 3 Kev/Campus, 4 Tanya/Outlet Mall,
5 Mr. Hale/Marina). `REP_START=20`, `REP_PERK=60` (perk unlocks), `REP_MIN_JOB=10` (no jobs below).
`JOBS {contactKey:[template]}` — templates `{type:'rush'|'import'|'cook'|'case', title, text,
days:[lo,hi], rep, ...}`; the engine rolls qty/price/due inside these.
`STORY[3]` milestone copy (paid, supplier, bigone). `RULES` (every tunable, named).
`EVENTS {find,mugged,van,lawyer,feds,quiet,win,escaped,hit,bribe,custody,collectors,colPay,
colBeat,colVan,laylow,jobDone,jobFail,importIn,importLost,cookGood,cookBad,supplier}` copy with
`{placeholders}`, `RANKS [[threshold,title]...]` descending, last is `-Infinity`.

## js/game.js — the engine
`G.state` is the one mutable object. Owner of the state shape:

```
{ v:2, seedWord, seed, day, days, tier, loc, cash, bank, debt, principal, health, trunk, lawyers,
  lastFeds                   // day of the last Task Force chase (-99 = never); drives the cooldown
  heat                       // 0..100, the meter you manage (rounded to 0.1)
  dayVol                     // today's trading volume ($ × good.heat); becomes heat at the day turn
  overdue, creditCut         // consecutive overdue days; PayLater halved your ceiling
  inv[8], paid[8]            // paid = total cost basis per good (avgPaid = paid/inv)
  prices[8]                  // 0 = not traded here today; else integer ≥ 1
  hist[]                     // {day,loc,prices[]} snapshots for sparklines (≤90)
  event                      // day card: {kind, text, good?, offer?, price?, taken?}
                             // kind ∈ quiet|find|mugged|van|lawyer|spike|crash|feds|hit|clear|
                             //         collectors|laylow|job|jobfail|over
  encounter                  // null | {kind:'feds', agents, start, rounds} | {kind:'collectors', agents}
  phase                      // 'market' | 'encounter' | 'collectors' | 'over'
  rep[6]                     // 0..100 per contact (index = district)
  jobs[]                     // accepted jobs {id,type,contact,title,rep,due,accepted,text, ...per type}
  board{districtIdx:[job]}   // offers, rerolled for the district you arrive in / lay low in
  nextJob                    // id counter
  story{paid,supplier,bigone,bigoneDone}, supplierNext (day), supplierOffer null|{day,good,qty,price}
  log[] ≤80 {day,text}, stats {bought,sold,profit,escapes,bribes,cases,jobs,jobsFailed,laundered},
  rng                        // RNG.state mirror — the resume key
  result                     // null | {why:'time'|'custody'|'collectors', netWorth, score, rank, day, tier} }
```

### Lifecycle
- `G.new(seedWord, days, tier)` → state (days clamped to `RULES.daysOptions[0]` if not an
  option; tier clamped to 1). Seeds RNG from `hashSeed(seedWord+'|'+tier)`, applies
  `TIERS[tier]` (cash, debt = principal, trunk), rolls day-1 prices and the Downtown board.
- `G.save()` → JSON string. `G.load(jsonOrObj)` → state or `null` (rejects bad
  JSON, `v!==2`, wrong `inv` length); restores `RNG.state` from `s.rng`.

### Actions — all return `{ok:boolean, msg?:string, over?:true}`
Market phase only: `buy(i,n)`, `sell(i,n)`, `travel(dest)`, `layLow()`,
`accept(boardIdx)`, `deliver(jobId)`, `launder(n)` (Outlet Mall, loc 4),
`supplierBuy()` (Port, loc 1, after `story.supplier`).
Encounter phase only: `run()`, `lawyerUp()`, `bribe()`.
Collectors phase only: `colPay()`, `colBeat()`, `colVan()`.
Market phase, HOME only (`canService`): `deposit(n)`, `withdraw(n)`, `payDebt(n)`,
`borrow(n)`, `heal()`. `acceptOffer()` when `event.offer && !event.taken`.
`n` is floored; `n<=0`/NaN refused. `over:true` appears only on the call that
ended the game (`travel`/`layLow` past the last day, a `run` that dropped health ≤ 0,
a `colBeat` that dropped health ≤ 0).

Read-only helpers (take `s`): `T (tier row), used, space, stashValue, netWorth (cash+bank-debt),
score (netWorth × tier.scoreMult), maxLoan, bribeCost, canService (loc===HOME && market),
avgPaid(s,i), maxBuy(s,i), hasPerk(s,c) (rep[c] ≥ REP_PERK), fedsOdds, isOverdue,
launderFee, heatForecast (tonight's heat change given today's trades), collectorsPay`;
`G.rank(nw)` → title; `G._midPrice(i)`.

### Tiers
Everything difficulty-shaped comes from `G.T(s)`: start `cash`/`debt`, daily loan `rate`,
`fedsMax` (encounter odds at heat 100), `vol` (price band width: the log-uniform draw is
`0.5 + (u−0.5)×vol`, so vol>1 steps outside `[lo,hi]`), `cost` (bribes, clinic, van/lawyer
prices), base `trunk`, `scoreMult`, `cutCredit` (collectors halve `maxLoan`).

### Heat
`buy`/`sell`/`deliver` add `value × good.heat` to `dayVol` (buys × `heatBuyFrac`, sells into a
spike × `heatSpikeMult`). At every day turn (`_newDay`, i.e. travel or lay low):
`heat += heatVolBase × log2(1 + dayVol/heatVolUnit) − heatDecay`, `dayVol=0`. Travel then adds
`(Σ inv×good.heat / trunk) × heatCarry`. `layLow` subtracts `heatLayLow`; `lawyerUp` −`heatLawyer`;
`launder` −`heatLaunder`; `bribe` +`heatBribe`; a bad cook +`heatBadBatch`. Clamped to [0,100].
`fedsOdds = 0` with an empty trunk, else `min(0.95, (fedsBase + heat/100 × tier.fedsMax) × cool)`
where `cool = min(1, (day − lastFeds)/heatDays)` — no chase the day of a chase, odds ramp back
over `heatDays` (soft: a next-day chase is possible at 1/heatDays odds).

### PayLater collectors
`principal` = the debt as of the last borrow/payment. `isOverdue` when `debt > principal ×
overdueMult`; `overdue` counts consecutive overdue days at each day turn. Once
`overdue ≥ overdueDays`, every travel/lay-low rolls `collectorsChance` → `phase='collectors'`
(before the feds; sets `creditCut` on `cutCredit` tiers). Then one of:
- `colPay()`: refuses if `cash < ceil(debt×collectorsMinFrac)`; else pays
  `min(cash, ceil(debt×collectorsPayFrac))`, `principal=debt`, `overdue=0`.
- `colBeat()`: health −`[collectorsHit]`, `floor(inv×collectorsSeize)` skimmed from every stack,
  `overdue=0`, `principal=debt`; health ≤ 0 → `_end('collectors')`.
- `colVan()`: refuses at the tier's base trunk; else trunk → base, overflow dropped from the
  last goods first, `overdue=0`, `principal=debt`.

### Contacts & jobs
`_board(s)` rerolls `board[loc]` on every arrival (and lay low): 1..`boardSize` jobs from that
contact's `JOBS` templates, none if `rep[loc] < REP_MIN_JOB`. `accept(k)` enforces `maxJobs`,
takes import cost up front, takes the cook's bottles, refuses a case at/over its heat line.
`_jobsTick` runs at every arrival / lay low, before collectors and the feds:
- **rush** (Kev, Tanya, Hale): `deliver(id)` at the contact's district with the stock (Hale
  also wants `heat < j.heat`) pays `qty×price`; `day > due` → fail.
- **import** (Vic): lands only if `loc===Port && day===due` (clipped to trunk space, basis =
  wholesale price); `day > due` → lost.
- **cook** (Dee): at DCR on/after `due`, `RNG.chance(badP)` → bad batch (60% back,
  +`heatBadBatch`, fail) else `out` bottles back; uncollected `due+4` days → sold off.
- **case** (Lorna): fails the moment `heat ≥ j.heat`; at `due` pays `retainers` lawyers.
Success: `rep += j.rep`, `stats.jobs++`, `event.kind='job'`. Failure: `rep −= j.rep+5`,
`stats.jobsFailed++`, `event.kind='jobfail'`. Perks at `REP_PERK`: Lorna bribes ×0.7, Vic
imports at 40% of lo, Dee +0.2 yield & badP 0, Kev Campus prices ×0.9, Tanya `launderFeePerk`,
Hale ×1.5 qty & ×1.2 price on his orders.

### Story
`payDebt` to zero → `story.paid`, `story.supplier`, `supplierNext=day`. `_supplierRoll` on
arriving at the Port (day ≥ `supplierNext`) posts `supplierOffer {day,good,qty∈supplierQty,
price=lo×supplierMult}`; `supplierBuy()` takes it (cash, trunk space) and sets
`supplierNext = day+supplierEvery`. `_storyRoll` (travel only): once `story.supplier` and
`day ≥ floor(days/2)`, arriving at the Marina unshifts **The Big One** onto `board[5]` — a
rush job for Hale (`story:'bigone'`, coke `qty` + heroin `extraQty`, due `days−1`, heat<40).
Delivering it sets `story.bigoneDone`.

### Travel / lay low = the day turning over
`travel(dest)`: refuse if same loc / out of range / not market. `_newDay`: day+1,
debt ×(1+tier.rate), bank ×(1+bankRate) (both rounded), overdue tick, volume → heat. Carry heat.
If `day > days` → `_end('time')`. Else new prices, then `_arrive` decides, in priority order:
0. job resolutions (`_jobsTick`) — may write the day card
1. collectors (if overdue ≥ overdueDays, collectorsChance) → `phase='collectors'`
2. Task Force (odds `fedsOdds`) → `phase='encounter'`, `lastFeds=day`
3. price event (spike = `hi × spikeMult × vol`, crash = `lo ÷ (crashDiv × vol)`)
4. non-price event: find / mugged (10–25% of cash, if cash>500) / van offer / lawyer offer
5. quiet.
Then the board, supplier and story rolls. `layLow()`: same day turn in place, `−heatLayLow`,
jobs tick, collectors roll, no feds / price / non-price events.

Price band: log-uniform in `[lo,hi]` widened by `tier.vol`, × CHEAP_MULT or DEAR_MULT by
district (× 0.9 on Campus with Kev's perk); `availMin..availMax` goods trade per day.

### Phase state machine
```
market --travel/layLow--> market       (quiet / price / non-price / job / laylow event)
market --travel--> encounter           (feds)
market --travel/layLow--> collectors   (overdue)
market --travel/layLow (day>days)--> over    result.why='time'
encounter --run (escape) / bribe / lawyerUp (agents→0)--> market   (event.kind='clear')
encounter --run (hit, health>0)--> encounter  (event.kind='hit', rounds++)
encounter --run (health≤0)--> over   result.why='custody': cash=0, inv/paid zeroed
collectors --colPay / colVan--> market (event.kind='clear'); --colBeat--> market (event.kind='hit')
collectors --colBeat (health≤0)--> over   result.why='collectors'
over: everything refuses ('Not now.')
```

## js/audio.js / js/ui.js
UI owns index.html DOM + css. Reads `G.state` and calls the action API above;
never mutates state directly, never touches RNG. Debug hook: `window.DwDbg`.
localStorage keys: `drugwars26.*`. Audio is no-op safe headless (test/shim.js
stubs AudioContext).

## Tests must not hardcode content
GOODS keys/names/bands, district cheap/dear, RANKS titles and EVENTS copy are
tuning data and change freely — suites read them from the globals.

## Known engine findings (test/engine.js prints, does not assert)
- The Task Force cooldown is soft: `fedsOdds` is 0 the day of a chase but 1/heatDays of
  normal the next day, so next-day chases still happen (the sweep counts them).
- The Big One's `deliver` pays only `qty × price` for the coke and never takes or pays for
  the `extraGood`/`extraQty` heroin the job text promises.

## js/art.js — procedural visuals (canvas only, reads state, never mutates, never touches RNG)
`ART.icon(k,size)` cached pixel-art canvas per good key · `ART.map(cv,state,{hover,t,route,car})` the
city map · `ART.mapHit(cv,ev)` → district index or -1 · `ART.spark(cv,vals,lo,hi,cur)` price history ·
`ART.scene(cv,encounter,t,{calm,hit})` the Task Force scene · `ART.gauge(cv,state)` trunk · `ART.bar(cv,frac,col)`.
Cosmetic randomness (map blocks) comes from a fixed local hash so the map is identical every load.
The engine keeps `state.hist` (price snapshots per day, ≤90) purely so sparklines can draw; no RNG involved.
