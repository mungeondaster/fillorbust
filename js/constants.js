export const TARGET_SCORE_OPTIONS = [5000, 10000];

// Opposite faces of a standard die sum to 7: (1,6) (2,5) (3,4)
export const FACE_TO_BOX_MATERIAL = { 1: 0, 6: 1, 2: 2, 5: 3, 3: 4, 4: 5 };

// Official 54-card Fill or Bust deck composition.
export const CARD_TYPES = [
  {
    id: "BONUS_300",
    label: "Bonus 300",
    desc: "You only get this +300 bonus if you FILL (score all 6 dice) this turn.",
    count: 12,
  },
  {
    id: "BONUS_400",
    label: "Bonus 400",
    desc: "You only get this +400 bonus if you FILL (score all 6 dice) this turn.",
    count: 10,
  },
  {
    id: "BONUS_500",
    label: "Bonus 500",
    desc: "You only get this +500 bonus if you FILL (score all 6 dice) this turn.",
    count: 8,
  },
  {
    id: "NO_DICE",
    label: "No Dice!",
    desc: "You lose this turn. If drawn after a FILL, you lose all points scored this turn (not points already on the scoresheet).",
    count: 8,
  },
  {
    id: "FILL_1000",
    label: "Fill 1000",
    desc: "You must keep rolling, no matter what. If you FILL, add a +1000 bonus.",
    count: 6,
  },
  {
    id: "MUST_BUST",
    label: "Must Bust",
    desc: "You must keep rolling with no limit on tosses or FILLs. If you bust, you keep the points instead of losing them.",
    count: 4,
  },
  {
    id: "VENGEANCE",
    label: "Vengeance 2500",
    desc: "Optional. If played, you must score a FILL or lose your turn. If you FILL, bank your points and subtract 2500 from the leader(s).",
    count: 4,
  },
  {
    id: "DOUBLE_TROUBLE",
    label: "Double Trouble",
    desc: "You must score two consecutive FILLs or lose your turn. If you do, double all points scored this turn and bank them.",
    count: 2,
  },
];

export function buildDeck() {
  const deck = [];
  let uid = 0;
  for (const type of CARD_TYPES) {
    for (let i = 0; i < type.count; i++) {
      deck.push({ uid: uid++, ...type });
    }
  }
  return deck;
}
