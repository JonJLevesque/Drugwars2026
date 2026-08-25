'use strict';
/* ==================================================================
   DATA — the 2026 street, as pure data. Nothing here computes.
   Goods: lo/hi are the everyday price band; a spike or crash steps
   outside it. Order is the hotkey order (1-8) — don't reshuffle.
   ================================================================== */
const GOODS=[
  {k:'coke', name:'Cocaine',  unit:'key',    lo:14000, hi:29000,
   spike:'Customs seized a submarine at the Port. Coke is scarce and everyone knows it.',
   crash:'A cartel price war spilled into town. Keys are going for nothing.'},
  {k:'her',  name:'Heroin',   unit:'brick',  lo:5000,  hi:13500,
   spike:'The Task Force rolled up two stash houses. Heroin just tripled.',
   crash:'A new pipeline opened through the Marina. Bricks are flooding the streets.'},
  {k:'ket',  name:'Ketamine', unit:'bottle', lo:800,   hi:3600,
   spike:'Every clinic in the city got cut off. Ketamine is the hottest thing in town.',
   crash:'A vet-supply warehouse got cleaned out. Bottles are practically free.'},
  {k:'mol',  name:'Molly',    unit:'jar',    lo:420,   hi:1700,
   spike:'Festival weekend. Molly is gone and the kids are paying anything.',
   crash:'A bad batch made the news. Nobody is touching molly this week.'},
  {k:'shr',  name:'Shrooms',  unit:'bag',    lo:280,   hi:1100,
   spike:'A ballot measure passed and the dispensaries have not opened yet. Shrooms are gold.',
   crash:'Everyone with a closet is growing now. Shrooms are worthless.'},
  {k:'weed', name:'Weed',     unit:'pound',  lo:300,   hi:950,
   spike:'The state cracked down on the dispensaries. Street weed is back.',
   crash:'The next state over went legal. Pounds are worth nothing here.'},
  {k:'xan',  name:'Xans',     unit:'rack',   lo:110,   hi:520,
   spike:'A pill press got seized. Xans just doubled twice.',
   crash:'Someone found a pallet of pressed bars. Xans are a dollar a pop.'},
  {k:'add',  name:'Addys',    unit:'bottle', lo:70,    hi:380,
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

/* Tunables — every number the engine leans on lives here, named. */
const RULES={
  startCash:2000, startDebt:5500, startTrunk:100, startHealth:100,
  loanRate:0.10,          // per day, compounding
  bankRate:0.01,          // per day
  maxLoanMult:2.5,        // total debt may reach this × net worth
  loanFloor:8000,         // ...but PayLater always carries you to this much
  availMin:5, availMax:7, // goods on offer per day (of 8)
  eventRate:0.36,         // chance per travel of a non-price event
  priceEventRate:0.18,    // chance per travel of a spike or crash
  spikeMult:[2.6,4.2], crashDiv:[2.8,4.5],
  fedsBase:0.05, fedsPerDay:0.35, fedsPerValue:0.20, // encounter odds pieces
  fedsMax:0.55,
  runBase:0.62, runPerAgent:0.09,
  hitLo:9, hitHi:22,        // health lost when a run fails
  bribePerAgent:650,
  clinicPerHp:22,
  vanPrice:[2200,5200], vanBonus:60,
  lawyerPrice:[900,2600],
  seizeFrac:0.35,           // stash lost when caught outright
  daysOptions:[30,45,60],
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
};

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
