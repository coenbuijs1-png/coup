/* ============================================================
   COUP — Card / role definitions
   ============================================================ */

const ROLES = {
  duke: {
    name: 'Duke',
    image: 'cards/duke.jpg',
    action: { name: 'Tax', desc: 'Take 3 coins.' },
    blocks: ['foreign_aid'],
  },
  assassin: {
    name: 'Assassin',
    image: 'cards/assassin.jpg',
    action: { name: 'Assassinate', desc: 'Pay 3 coins, force opponent to lose an influence.' },
    blocks: [],
  },
  ambassador: {
    name: 'Ambassador',
    image: 'cards/ambassador.jpg',
    action: { name: 'Exchange', desc: 'Draw 2 from the deck, swap cards, return 2.' },
    blocks: ['steal'],
  },
  captain: {
    name: 'Captain',
    image: 'cards/captain.jpg',
    action: { name: 'Steal', desc: 'Take 2 coins from opponent.' },
    blocks: ['steal'],
  },
  contessa: {
    name: 'Contessa',
    image: 'cards/contessa.jpg',
    action: null,
    blocks: ['assassinate'],
  },
};

const ALL_ROLES = ['duke', 'assassin', 'ambassador', 'captain', 'contessa'];

function buildDeck() {
  const deck = [];
  for (const role of ALL_ROLES) {
    for (let i = 0; i < 3; i++) deck.push(role);
  }
  return deck;
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ============================================================
   Action definitions
   ============================================================ */

const ACTIONS = {
  income: {
    label: 'Income',
    role: null,
    cost: 0,
    needsTarget: false,
    challengeable: false,
    blockable: false,
    desc: 'Take 1 coin.',
  },
  foreign_aid: {
    label: 'Foreign Aid',
    role: null,
    cost: 0,
    needsTarget: false,
    challengeable: false,
    blockable: true,
    blockedBy: ['duke'],
    desc: 'Take 2 coins. Can be blocked by Duke.',
  },
  coup: {
    label: 'Coup',
    role: null,
    cost: 7,
    needsTarget: true,
    challengeable: false,
    blockable: false,
    desc: 'Pay 7 coins, force opponent to lose an influence.',
  },
  tax: {
    label: 'Tax',
    role: 'duke',
    cost: 0,
    needsTarget: false,
    challengeable: true,
    blockable: false,
    desc: 'Claim Duke — take 3 coins.',
  },
  assassinate: {
    label: 'Assassinate',
    role: 'assassin',
    cost: 3,
    needsTarget: true,
    challengeable: true,
    blockable: true,
    blockedBy: ['contessa'],
    desc: 'Claim Assassin — pay 3, opponent loses influence.',
  },
  exchange: {
    label: 'Exchange',
    role: 'ambassador',
    cost: 0,
    needsTarget: false,
    challengeable: true,
    blockable: false,
    desc: 'Claim Ambassador — swap cards with the court deck.',
  },
  steal: {
    label: 'Steal',
    role: 'captain',
    cost: 0,
    needsTarget: true,
    challengeable: true,
    blockable: true,
    blockedBy: ['captain', 'ambassador'],
    desc: 'Claim Captain — take 2 coins from opponent.',
  },
};
