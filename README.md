# Drugwars 2026 💊

The TI-83 classic, thirty years on. Thirty days, six districts, a PayLater
loan compounding 10% a day, and a trunk to fill. Buy low, sell high, keep
your heat down, and run, bribe, or lawyer your way past the Task Force —
before PayLater sends the collectors.

**Play it: open `index.html` in any modern browser.** No server, no build step,
no dependencies — vanilla HTML, CSS, and JavaScript.

## How to play

Pick a **tier** first. CORNER is a soft landing ($3,000 cash, $5,000 owed at
6%). BLOCK is the classic: **$2,000** in cash, **$15,000** owed to PayLater,
compounding **10% a day**. CARTEL and FEDERAL shrink the trunk, widen the
prices, raise the rate to 13% and 15%, and send real collectors — and score
2× and 4× for the trouble. Every day you can buy and sell whatever's on
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

**Heat** is the meter you manage. Every dollar you move adds to it (keys and
bricks count full, weed and addys barely), a trunk full of product draws eyes
on the drive, and a quiet day sheds a little. The hotter you are, the more
likely the **Task Force** is waiting on the way in — never with an empty
trunk, and never twice in a row. Too hot? **Lay low**: a day inside with the
curtains drawn drops the heat hard, but the calendar still turns and the
loan still compounds.

On the drive in you might find a dead drop, get SIM‑swapped, be offered a
**van** (+60 trunk) or a **lawyer** on retainer — or pick up the Task Force.
Then you **run** (a gamble that costs health when it fails), **lawyer up**
(burns a retainer, peels agents off, cools you down), or **bribe**
(guaranteed, priced by the headcount, and it adds heat). Run out of health
and it's federal custody: cash and stash logged into evidence.

Let the loan run more than 60% past what you borrowed for three days straight
and PayLater stops texting. The **collectors** box in the van and you pick:
**pay** (a quarter of the debt, cash, and they won't take less than a tenth),
**take the beating** (health, and a cut of every stack in the trunk), or
**hand over the van** (back to the base trunk, whatever doesn't fit stays on
the curb). On CARTEL and FEDERAL a visit also halves your credit line.

Every district has a **contact** with a job board — Lorna the lawyer
Downtown, Vic at the Port, Dee the chemist on Data Center Row, Kev on
Campus, Tanya at the Outlet Mall, Mr. Hale at the Marina. **Rush orders**
pay well above street price if you show up with the goods by the deadline
(Hale also wants you cool when you arrive). Vic's **containers** cost cash
up front and only land if you're at the Port on the day. Dee's **cooks** turn
bottles of ketamine into more bottles — usually. Lorna's **cases** pay a
retainer if you keep your heat under the line. Finish jobs and your rep
climbs; at 60 each contact hands you a perk. Blow a deadline and it drops.
You can hold two jobs at a time.

Downtown has the **bank** (1% a day, and the Task Force can't touch it), the
**PayLater** desk (pay down or borrow more, up to 2.5× your net worth), and
the **clinic**. Tanya at the Outlet Mall will **launder** cash straight into
the bank for a 12% cut (6% once she likes you) and takes some heat off you
while she's at it.

Pay PayLater to zero and Vic starts asking about you: the **supplier** puts
product on the table at the Port at 60% of the low price, once a week. And
once the supplier is yours and the run is half over, Mr. Hale calls with
**The Big One** — keys and bricks to the Marina before the last day, at a
price that makes everything else look like pocket change. Everyone will be
watching.

When the last day ends you're scored on **cash + bank − debt**, times the
tier multiplier. Unsold stash is worth nothing. Same seed word, same tier,
same prices, same events — every run is replayable from its seed.

Keys: `1`–`8` pick a good · `B` buy · `S` sell · `T` travel · `L` lay low ·
`Esc` back. Works with touch too.

## Code layout

Plain script tags share globals — load order matters (see `index.html`):

```
js/core.js    the seeded RNG (all gameplay randomness), money formatting
js/data.js    goods, districts, tiers, contacts, jobs, tunables, event copy — pure data
js/game.js    the engine: prices, trading, travel, heat, events, the Task Force,
              collectors, jobs, the supplier, The Big One
js/art.js     procedural canvas art: map, icons, sparklines, the chase scene
js/audio.js   Web Audio blips
js/ui.js      DOM rendering, modals, keys, save/resume, high scores
```

`CONTRACT.md` records the cross-module interface.

## Tests

```
node test/boot.js       # modules load in index.html order; globals exist
node test/engine.js     # determinism, resume ≡ straight-through, tiers, price
                        # bands, trade refusals, heat, loan math, encounters,
                        # collectors, jobs, supplier, The Big One, endings —
                        # plus a per-tier Monte Carlo balance report
```
