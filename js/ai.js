// Approximate bust-probability table for standard 6-dice scoring (1s/5s/n-of-a-kind)
// keyed by number of dice about to be rolled. Used only to guide CPU risk-taking.
const BUST_RISK = { 1: 0.67, 2: 0.44, 3: 0.28, 4: 0.13, 5: 0.08, 6: 0.03 };

// Decide whether the CPU should bank now or keep rolling.
// turnScore: points accumulated & held so far this turn (not yet banked)
// diceRemaining: dice left to roll if it continues
// currentTotal / targetScore: used to bank early once a win is in reach
export function cpuShouldBank({ turnScore, diceRemaining, currentTotal, targetScore, difficulty = "normal" }) {
  if (currentTotal + turnScore >= targetScore) return true;

  const risk = BUST_RISK[diceRemaining] ?? 0.3;
  const aggression = difficulty === "hard" ? 0.65 : difficulty === "easy" ? 1.35 : 1.0;
  // Expected-value style cutoff: keep rolling while the upside outweighs the
  // risk-weighted downside of losing turnScore.
  const continueEV = (1 - risk) * 150 - risk * turnScore * aggression;

  if (diceRemaining === 0) return false; // hot dice always continues elsewhere
  if (turnScore < 300 && diceRemaining >= 3) return false;
  return continueEV < 0;
}

export function cpuThinkDelay() {
  return 650 + Math.random() * 550;
}
