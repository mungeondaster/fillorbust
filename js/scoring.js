// Scoring rules for Fill or Bust
// Single 1 = 100, single 5 = 50 (these always score individually, no matter
// how many of them are rolled)
// Three of a kind: value*100 (three 1s = 1000) -- there is no bonus for a
// fourth, fifth, or sixth matching die; only exactly three of a kind scores.
// Straight 1-2-3-4-5-6 (all six dice, one roll) = 1500

export function tripleBase(value) {
  return value === 1 ? 1000 : value * 100;
}

// Given an array of die values (the dice a player has selected to hold from
// one roll), return { valid, score, breakdown } describing whether every
// die in the selection contributes to a legal score.
export function scoreSelection(values) {
  if (values.length === 6 && isStraight(values)) {
    return { valid: true, score: 1500, breakdown: [{ label: "Straight 1-6", score: 1500 }] };
  }

  const counts = countByFace(values);
  let score = 0;
  const breakdown = [];
  let usedDice = 0;

  for (let v = 1; v <= 6; v++) {
    const c = counts[v];
    if (v === 1 || v === 5) {
      // 1s and 5s always score individually; a triple of them also earns
      // the three-of-a-kind bonus on top, but a fourth/fifth/sixth beyond
      // that is just more individual singles, not another bonus.
      if (c === 0) continue;
      const per = v === 1 ? 100 : 50;
      const val = c >= 3 ? tripleBase(v) + per * (c - 3) : per * c;
      score += val;
      usedDice += c;
      breakdown.push({ label: `${c} x ${v}${c >= 3 ? "'s" : " (single)"}`, score: val });
    } else if (c === 3) {
      // Exactly three of a kind: the only way a non-1/5 value scores.
      const val = tripleBase(v);
      score += val;
      usedDice += c;
      breakdown.push({ label: `3 x ${v}'s`, score: val });
    }
    // c > 3 for a non-1/5 value: only three of them can ever score: the
    // extras are left un-scored, which is exactly what should make a
    // selection that includes all of them invalid (see below).
  }

  const valid = usedDice === values.length && values.length > 0;
  return { valid, score: valid ? score : 0, breakdown: valid ? breakdown : [] };
}

// Returns true if the given set of dice values (a full roll, e.g. 6 or fewer
// remaining dice) contains ANY scoring potential at all. Used to detect a bust.
export function hasAnyScore(values) {
  if (values.length === 6 && isStraight(values)) return true;
  const counts = countByFace(values);
  for (let v = 1; v <= 6; v++) {
    if (counts[v] >= 3) return true;
  }
  if (counts[1] > 0 || counts[5] > 0) return true;
  return false;
}

// Greedy "best" selection among a set of rolled dice indices+values -- used
// by the CPU and by the "auto hold" helper. Picks every die that can be part
// of a legal, maximal scoring group. For a non-1/5 value rolled more than
// three times, only three are taken (a fourth/fifth/sixth can't score, so
// they're left un-held to be rerolled).
export function bestSelection(values) {
  if (values.length === 6 && isStraight(values)) {
    return values.map((_, i) => i);
  }
  const counts = countByFace(values);
  const takenByValue = {};
  for (let v = 1; v <= 6; v++) {
    if (v === 1 || v === 5) takenByValue[v] = counts[v];
    else if (counts[v] >= 3) takenByValue[v] = 3;
    else takenByValue[v] = 0;
  }
  const indices = [];
  const remaining = { ...takenByValue };
  values.forEach((v, i) => {
    if (remaining[v] > 0) {
      indices.push(i);
      remaining[v]--;
    }
  });
  return indices;
}

function countByFace(values) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const v of values) counts[v]++;
  return counts;
}

function isStraight(values) {
  const sorted = [...values].sort();
  for (let i = 0; i < 6; i++) if (sorted[i] !== i + 1) return false;
  return true;
}
