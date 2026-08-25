'use strict';
/* ==================================================================
   DATA — the 2026 street, as pure data. Nothing here computes.
   Goods: lo/hi are the everyday price band; a spike or crash steps
   outside it. Order is the hotkey order (1-8) — don't reshuffle.
   ================================================================== */
const GOODS=[
  {k:'coke', heat:1.0, name:'Cocaine',  unit:'key',    lo:14000, hi:29000,
   spike:'Customs seized a submarine at the Port. Coke is scarce and everyone knows it.',
   crash:'A cartel price war spilled into town. Keys are going for nothing.'},
  {k:'her', heat:1.0,  name:'Heroin',   unit:'brick',  lo:5000,  hi:13500,
   spike:'The Task Force rolled up two stash houses. Heroin just tripled.',
   crash:'A new pipeline opened through the Marina. Bricks are flooding the streets.'},
  {k:'ket', heat:0.5,  name:'Ketamine', unit:'bottle', lo:800,   hi:3600,
   spike:'Every clinic in the city got cut off. Ketamine is the hottest thing in town.',
   crash:'A vet-supply warehouse got cleaned out. Bottles are practically free.'},
  {k:'mol', heat:0.5,  name:'Molly',    unit:'jar',    lo:420,   hi:1700,
   spike:'Festival weekend. Molly is gone and the kids are paying anything.',
   crash:'A bad batch made the news. Nobody is touching molly this week.'},
  {k:'shr', heat:0.3,  name:'Shrooms',  unit:'bag',    lo:280,   hi:1100,
   spike:'A ballot measure passed and the dispensaries have not opened yet. Shrooms are gold.',
   crash:'Everyone with a closet is growing now. Shrooms are worthless.'},
  {k:'weed', heat:0.3, name:'Weed',     unit:'pound',  lo:300,   hi:950,
   spike:'The state cracked down on the dispensaries. Street weed is back.',
   crash:'The next state over went legal. Pounds are worth nothing here.'},
  {k:'xan', heat:0.4,  name:'Xans',     unit:'rack',   lo:110,   hi:520,
   spike:'A pill press got seized. Xans just doubled twice.',
   crash:'Someone found a pallet of pressed bars. Xans are a dollar a pop.'},
  {k:'add', heat:0.3,  name:'Addys',    unit:'bottle', lo:70,    hi:380,
   spike:'Finals week. Addys are gold on Campus.',
   crash:'A telehealth app started prescribing to anyone with a phone. Addys are worthless.'},
];

/* Districts. `cheap`/`dear` bias one good each so the map matters.
   Index 0 is home: bank, loan desk, and the clinic live there. */
const DISTRICTS=[
  {k:'down', name:'Downtown',        blurb:'banks, lawyers, the loan desk',   cheap:'xan', dear:'shr'},
  {k:'port', name:'The Port',        blurb:'containers, customs, cheap keys', cheap:'coke',dear:'weed'},
  {k:'dcr',  name:'Data Center Row', blurb:'server techs with money to burn',  cheap:'ket', dear:'coke'},
  {k:'camp', name:'Campus',          blurb:'students with parental money',    cheap:'weed',dear:'add'},
  {k:'mall', name:'The Outlet Mall', blurb:'dealers in every parking lot',  cheap:'mol', dear:'xan'},
  {k:'mar',  name:'The Marina',      blurb:'old money, new appetites',        cheap:'her', dear:'mol'},
];
const HOME=0;
const CHEAP_MULT=0.72, DEAR_MULT=1.35;

/* Difficulty tiers. Everything the tier touches is a plain field here;
   the engine reads G.T(s). Order = title-screen order; index 1 is default. */
const TIERS=[
  {k:'corner',  name:'CORNER',  blurb:'a soft landing. learn the map.',           cash:3000, debt:5000,  rate:0.06, fedsMax:0.30, vol:0.8, cost:0.7, trunk:120, scoreMult:0.5, cutCredit:false},
  {k:'block',   name:'BLOCK',   blurb:'the classic. thirty days, ten percent.',   cash:2000, debt:15000, rate:0.10, fedsMax:0.45, vol:1.0, cost:1.0, trunk:100, scoreMult:1,   cutCredit:false},
  {k:'cartel',  name:'CARTEL',  blurb:'small trunk, wild prices, real collectors.', cash:2000, debt:40000, rate:0.13, fedsMax:0.60, vol:1.3, cost:1.5, trunk:80,  scoreMult:2,   cutCredit:true},
  {k:'federal', name:'FEDERAL', blurb:'sixty grand in the hole at fifteen percent. good luck.',      cash:1000, debt:60000, rate:0.15, fedsMax:0.75, vol:1.6, cost:2.5, trunk:60,  scoreMult:4,   cutCredit:true},
];

/* Contacts — one per district, index = DISTRICTS index. Rep 0..100. */
const CONTACTS=[
  {k:'lorna', name:'Lorna',    role:'the lawyer',   line:'"Call me before you say anything."',          perk:'bribes 30% cheaper'},
  {k:'vic',   name:'Vic',      role:'customs',      line:'"Containers come in. Some of them leave."',    perk:'imports at 40% of low'},
  {k:'dee',   name:'Dee',      role:'the chemist',  line:'"Bring me bottles. I bring you more bottles."',perk:'better yields, no bad batches'},
  {k:'kev',   name:'Kev',      role:'campus plug',  line:'"Finals week, bro. Finals week."',             perk:'campus buys 10% cheaper'},
  {k:'tanya', name:'Tanya',    role:'the mall',     line:'"Cash is a problem I solve."',                  perk:'laundering fee halved'},
  {k:'hale',  name:'Mr. Hale', role:'old money',    line:'"Discretion. Then price. Then discretion."',   perk:'bigger orders, better prices'},
];
const REP_START=20, REP_PERK=60, REP_MIN_JOB=10;

/* Tunables — every number the engine leans on lives here, named. */
const RULES={
  startHealth:100,
  bankRate:0.01,          // per day
  availMin:5, availMax:7, // goods on offer per day (of 8)
  eventRate:0.36,         // chance per travel of a non-price event
  priceEventRate:0.18,    // chance per travel of a spike or crash
  spikeMult:[2.6,4.2], crashDiv:[2.8,4.5],
  fedsBase:0.04,          // encounter odds = base + heat/100 × tier.fedsMax, × cooldown
  heatDays:3,             // days for encounter odds to ramp back after a chase
  /* heat: 0..100, the meter you manage */
  heatVolBase:8, heatVolUnit:5000, // heat/day = base × log2(1 + volume/unit); volume = $ × good.heat
  heatBuyFrac:0.5,        // buying counts half of selling
  heatSpikeMult:1.5,      // selling into a spike draws eyes
  heatCarry:3,            // +this per day at a full trunk of weight-1 goods
  heatDecay:6,            // -this per quiet day
  heatLayLow:25, heatLawyer:15, heatBribe:8, heatLaunder:10, heatBadBatch:12,
  /* PayLater collectors */
  overdueMult:1.6,        // overdue when debt > principal × this
  overdueDays:3,          // ...for this many consecutive days
  collectorsChance:0.5,   // per travel once overdue
  collectorsPayFrac:0.25, // they take this much of the debt in cash
  collectorsMinFrac:0.10, // ...and won't take less than this
  collectorsHit:[25,40], collectorsSeize:0.30,
  /* jobs */
  maxJobs:2, boardSize:2,
  launderFee:0.12, launderFeePerk:0.06,
  supplierEvery:7, supplierMult:0.6, supplierQty:[10,25],
  runBase:0.62, runPerAgent:0.09,
  hitLo:9, hitHi:22,        // health lost when a run fails
  bribePerAgent:650,
  clinicPerHp:22,
  vanPrice:[2200,5200], vanBonus:60,
  lawyerPrice:[900,2600],
  seizeFrac:0.35,           // stash lost when caught outright
  daysOptions:[30,45,60],
  maxLoanMult:2.5, loanFloor:8000,
};

/* Flavor. Each event has `text` shown in the day card; the engine picks
   by key and fills in the blanks. Writing lives here, not in game.js. */
const EVENTS={
  find:   ['A courier left a {unit} of {good} in the back of a ride-share. Finders keepers.',
           'A dead drop nobody came back for: {n} {unitPl} of {good}.'],
  mugged: ['SIM-swapped. By the time you got your number back, {money} had walked.',
           'Your card got skimmed at a charging station. {money} gone.',
           'A "verification call" from the bank. It was not the bank. {money} gone.'],
  van:    ['A guy at the loading dock is selling a cargo van, no questions. {money} for +{n} trunk.'],
  lawyer: ['A lawyer hands you a card: "Retainer, {money}. Call me before you say anything."'],
  feds:   ['The Task Force is on your tail. {n} agents, unmarked SUVs.',
           'Blue lights in the mirror. {n} agents from the Task Force.',
           'Someone tipped the Task Force. {n} agents close in.'],
  quiet:  ['Uneventful drive. True-crime podcast about a guy who did exactly this and got 20 years.',
           'Traffic. The car next to you has a Task Force sticker. You do not make eye contact.',
           'A billboard: "TALK TO YOUR KIDS ABOUT KETAMINE." You keep driving.',
           'Your group chat says coke is about to pop. Your group chat is usually wrong.'],
  win:    ['The agents confer, look at your paperwork, and drive off.',
           'Your lawyer says four words on the phone. They leave.'],
  escaped:['You lose them in the parking structure.',
           'You cut through the drive-thru and they lose the tail.'],
  hit:    ['They box you in. You take a beating getting free.',
           'A tase in the parking lot. You still got away, barely.'],
  bribe:  ['{money} in an envelope. The paperwork "gets lost."'],
  custody:['Federal custody. Your cash and stash are logged into evidence.'],
  collectors:['PayLater sent people. {n} of them, and one has a bat.',
              'Two SUVs box in the van. PayLater does not send texts anymore.'],
  colPay:    ['You hand over {money}. "Same time next week, unless you\'re smart."'],
  colBeat:   ['They work you over in the parking lot and help themselves to the trunk.'],
  colVan:    ['They take the van. You walk to the bus with whatever you could carry.'],
  laylow:    ['You spend the day inside. Delivery apps, blackout curtains, no phone.',
              'A day at the movies. Nobody follows you home.'],
  jobDone:   ['{name} pays out {money}. "Pleasure."'],
  jobFail:   ['{name}: "You had a deadline." That relationship just got colder.'],
  importIn:  ['The container clears. {qty} {unitPl} of {good} in the van.'],
  importLost:['You were not at the Port. The container went to somebody else.'],
  cookGood:  ['Dee slides over {qty} bottles. Better than what you left.'],
  cookBad:   ['Bad batch. Dee hands back {qty} bottles and a warning: that smell travels.'],
  supplier:  ['Vic\'s guy: {qty} {unitPl} of {good} at {price} each. Once a week, no more.'],
};

/* Job templates by contact. qty/price are rolled by the engine within these.
   deadline = days from acceptance. rep = reward on success / cost on failure. */
const JOBS={
  lorna:[{type:'case',  title:'Stay clean',    text:'Keep your heat under {heat} for {days} days. I keep a retainer on file for you.', days:[3,5], heat:[30,45], rep:15, retainers:1}],
  vic:  [{type:'import',title:'Container',     text:'Shipment of {qty} {unitPl} of {good} lands at the Port on day {due}. Wholesale, cash up front. Be here that day or it walks.', days:[3,6], qtyFrac:[0.3,0.7], wholesale:0.5, rep:15}],
  dee:  [{type:'cook',  title:'Cook order',    text:'Leave me {qty} bottles of ketamine. Come back on day {due}: I hand you {yieldTxt}. Sometimes a batch goes wrong.', days:[3,5], qty:[15,35], yield:[1.35,1.6], badP:0.15, rep:15}],
  kev:  [{type:'rush',  title:'Rush order',    text:'{qty} {unitPl} of {good} on Campus by day {due}. Paying {price} each, no haggling.', days:[4,8], qtyFrac:[0.2,0.5], mult:[1.8,2.4], goods:['xan','add','mol','weed','shr'], rep:15}],
  tanya:[{type:'rush',  title:'Mall run',      text:'{qty} {unitPl} of {good} to the Outlet Mall by day {due}. {price} each.', days:[3,6], qtyFrac:[0.2,0.5], mult:[1.6,2.1], goods:['mol','ket','weed','xan'], rep:12}],
  hale: [{type:'rush',  title:'Private buyer', text:'{qty} {unitPl} of {good} to the Marina by day {due}. {price} each — and arrive with heat under {heat}, or I never met you.', days:[4,7], qty:[2,4], mult:[1.6,2.2], goods:['coke','her'], heat:[35,50], rep:20}],
};
/* the story chain: milestones that unlock as you play */
const STORY=[
  {k:'paid',     title:'Square with PayLater', text:'Pay the loan to zero. Vic has been asking about you.'},
  {k:'supplier', title:'The Supplier',         text:'Vic can move product at 60% of low, once a week, from the Port.'},
  {k:'bigone',   title:'The Big One',          text:'Hale wants {qty} keys of coke and {qty2} bricks of heroin before day {due}. He pays {price}. Everyone will be watching.'},
];

/* end-of-run titles by net worth, descending */
const RANKS=[
  [5000000,'DRUGWARS LEGEND'],
  [1000000,'Untouchable'],
  [250000,'Kingpin'],
  [100000,'Regional Distributor'],
  [30000,'Corner Boss'],
  [10000,'Runner'],
  [0,'Broke Even (Sort Of)'],
  [-Infinity,'Still Owes The Shark'],
];
