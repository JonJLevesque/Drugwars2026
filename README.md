# Drugwars 2026 💊

The TI-83 classic, thirty years on. Thirty days, six districts, a PayLater
loan compounding 10% a day, and a trunk to fill. Buy low, sell high, and
run, bribe, or lawyer your way past the Task Force.

**Play it: open `index.html` in any modern browser.** No server, no build step,
no dependencies — vanilla HTML, CSS, and JavaScript.

## How to play

You start Downtown with **$2,000** in cash and **$5,500** owed to PayLater,
compounding **10% a day**. Every day you can buy and sell whatever's on
offer, then **travel** to another district — which turns the calendar over,
reshuffles every price, and rolls the dice on the drive in.

The product, with its everyday price bands:

| # | Good     | Unit   | Band          |
|---|----------|--------|---------------|
| 1 | Cocaine  | key    | $14K – $29K   |
| 2 | Heroin   | brick  | $5K – $13.5K  |
| 3 | Ketamine | bottle | $800 – $3.6K  |
| 4 | Molly    | jar    | $420 – $1.7K  |
| 5 | Shrooms  | bag    | $280 – $1.1K  |
| 6 | Weed     | pound  | $300 – $950   |
| 7 | Xans     | rack   | $110 – $520   |
| 8 | Addys    | bottle | $70 – $380    |

Each district sells one thing cheap and buys one thing dear. Some days a
**spike** (a seized submarine, festival weekend, finals on Campus) or a
**crash** (the next state went legal, a bad batch made the news) throws a
price far outside its band — that's where the money is.

On the drive in you might find a dead drop, get SIM‑swapped, be offered a
**van** (+60 trunk) or a **lawyer** on retainer — or pick up the **Task
Force**. Then you **run** (a gamble that costs health when it fails),
**lawyer up** (burns a retainer, peels agents off, no risk), or **bribe**
(guaranteed, priced by the headcount). Run out of health and it's federal
custody: cash and stash logged into evidence.

Downtown has the **bank** (1% a day, and the Task Force can't touch it), the
**PayLater** desk (pay down or borrow more), and the **clinic**.

When the last day ends you're scored on **cash + bank − debt**. Unsold stash
is worth nothing. Same seed, same prices, same events — every run is
replayable from its seed word.

Keys: `1`–`8` pick a good · `B` buy · `S` sell · `T` travel · `Esc` back.
Works with touch too.

## Code layout

Plain script tags share globals — load order matters (see `index.html`):

```
js/core.js    the seeded RNG (all gameplay randomness), money formatting
js/data.js    goods, districts, tunables, event copy — pure data
js/game.js    the engine: prices, trading, travel, events, the Task Force
js/audio.js   Web Audio blips
js/ui.js      DOM rendering, modals, keys, save/resume, high scores
```

`CONTRACT.md` records the cross-module interface.

## Tests

```
node test/boot.js       # modules load in index.html order; globals exist
node test/engine.js     # determinism, resume ≡ straight-through, price
                        # bands, trade refusals, loan math, encounters,
                        # endings — plus a Monte Carlo balance report
```
