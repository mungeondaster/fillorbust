import { Dice3D } from "./dice3d.js?v=24";
import { CardTable } from "./cardsUI.js?v=24";
import { Deck } from "./deck.js?v=24";
import { scoreSelection, hasAnyScore, bestSelection } from "./scoring.js?v=24";
import { cpuShouldBank, cpuThinkDelay } from "./ai.js?v=24";
import { NullNet } from "./net.js?v=24";

const BONUS_VALUE = { BONUS_300: 300, BONUS_400: 400, BONUS_500: 500 };

export class Game {
  // `net` (optional): a NetSession for online play, or the default inert
  // NullNet for single-device play -- Game never branches on "am I online",
  // it just always has one or the other.
  // `myPlayerId` (optional): this client's own numeric index into `players`
  // (matching the `id` Game assigns below), used to tell "my turn" apart
  // from everyone else's. null in single-device play (every seat is "mine").
  constructor({ diceContainer, cardContainer, players, targetScore, ui, net, myPlayerId }) {
    this.dice3d = new Dice3D(diceContainer);
    this.cardTable = new CardTable(cardContainer);
    this.deck = new Deck();
    this.cardTable.render(this.deck);

    this.players = players.map((p, i) => ({ ...p, id: i, score: 0 }));
    this.targetScore = targetScore;
    this.ui = ui;
    this.net = net ?? new NullNet();
    this.myPlayerId = myPlayerId ?? null;

    this.currentPlayerIndex = 0;
    this.turnScore = 0;
    this.activeIndices = [0, 1, 2, 3, 4, 5];
    this.selected = new Set();
    this.currentCard = null;
    this.cardFlags = this._freshCardFlags();
    this.hasFilledThisTurn = false;
    this.finalRoundTriggered = false;
    this.finalRoundStarter = null;
    this.gameOver = false;

    this._startNetworkLoops();
    this.startTurn();
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  // Whether THIS client is the one that should act for `player`: their own
  // connected seat if human (myPlayerId is null in single-device play, where
  // every seat is "mine"), or the host's client if CPU (CPU turns aren't
  // tied to any particular human browser).
  isAuthorityForPlayer(player) {
    if (!player) return false;
    if (player.type === "cpu") return this.net.isHost;
    return this.myPlayerId === null || player.id === this.myPlayerId;
  }

  // Standing listeners for events nothing on a non-acting client's own side
  // would otherwise trigger (a button click or CPU timer only fires on the
  // acting client). Each just applies the same shared logic a local action
  // would -- see rollDice/humanBank/humanContinueAfterFill for the sending
  // side of each of these.
  _startNetworkLoops() {
    this._loopNetEvent("diceRolled", ({ indices, values }) => this.applyRemoteRoll(indices, values));
    this._loopNetEvent("humanHeld", ({ indices }) => {
      const values = indices.map((i) => this.dice3d.dice[i].value);
      const result = scoreSelection(values);
      this.commitHold(indices, result.score);
    });
    this._loopNetEvent("humanBank", () => this.bank());
    this._loopNetEvent("humanContinue", () => this.continueAfterFill());
  }

  _loopNetEvent(type, handler) {
    (async () => {
      for (;;) {
        const payload = await this.net.next(type);
        await handler(payload);
      }
    })();
  }

  _freshCardFlags() {
    return {
      bonusValue: null, // 300/400/500 -- credited into turnScore on the next FILL
      bonusCredited: false, // guards against crediting the same bonus card twice
      fillBonusRemaining: 0, // FILL_1000: needs exactly 1 more FILL
      mustBust: false, // MUST_BUST: never allowed to bank; a bust still pays out
      vengeancePending: false, // VENGEANCE (played): needs exactly 1 more FILL
      vengeanceLeaders: [],
      doubleTroublePending: 0, // DOUBLE_TROUBLE: needs this many more FILLs
    };
  }

  // While any of these are active, banking is not offered -- the player (or
  // CPU) must keep rolling until the condition resolves one way or another.
  bankBlocked() {
    const f = this.cardFlags;
    return f.mustBust || f.fillBonusRemaining > 0 || f.vengeancePending || f.doubleTroublePending > 0;
  }

  computeLeaders() {
    const max = Math.max(...this.players.map((p) => p.score));
    return this.players.filter((p) => p.score === max);
  }

  // ---------------- Turn lifecycle ----------------

  async startTurn() {
    this.turnScore = 0;
    this.activeIndices = [0, 1, 2, 3, 4, 5];
    this.selected.clear();
    this.hasFilledThisTurn = false;
    this.cardFlags = this._freshCardFlags();
    this.dice3d.resetAll();
    this.ui.syncDiceState(this.dice3d.dice);
    this.ui.resetDiceFaces();
    this.ui.setStatus(`${this.currentPlayer.name}'s turn`);
    this.ui.renderPlayers(this.players, this.currentPlayerIndex);
    this.ui.setTurnScore(0);
    this.ui.setHeld([]);
    this.ui.setRollEnabled(false);
    this.ui.setBankEnabled(false);

    await this.drawAndApplyCard();
  }

  // Draws a card, playing a shuffle animation first if the draw pile is
  // about to run out and needs the discards reshuffled back in. The
  // reshuffle-timing/pile-count bookkeeping is purely mechanical (doesn't
  // depend on card content), so it stays in lockstep across every client
  // for free -- only WHICH card comes up needs a single authority: the host.
  async _drawCard() {
    if (this.deck.needsReshuffle) {
      await this.cardTable.playShuffleAnimation();
    }
    const localCard = this.deck.draw();
    if (this.net.isHost) {
      this.net.broadcast("cardDrawn", { card: localCard });
      return localCard;
    }
    // Not the draw authority: the local draw() above only mattered for pile-
    // count bookkeeping (kept the reshuffle timing in sync) -- the actual
    // card is whatever the host says it is.
    const { card } = await this.net.next("cardDrawn");
    this.deck.activeCard = card;
    return card;
  }

  // Draws the turn's governing card. A VENGEANCE draw is a detour: the
  // player may decline (or be forced to, if they're the sole leader), in
  // which case it's discarded and a replacement is drawn -- looping until a
  // non-VENGEANCE card lands or a VENGEANCE is actually played.
  async drawAndApplyCard() {
    let card = await this._drawCard();
    for (;;) {
      this.currentCard = card;
      await this.cardTable.draw(card, this.deck);

      if (card.id !== "VENGEANCE") break;

      const leaders = this.computeLeaders();
      const forcedDecline = leaders.length === 1 && leaders[0].id === this.currentPlayer.id;
      const play = forcedDecline ? false : await this.resolveVengeance(leaders);

      if (play) {
        this.cardFlags.vengeancePending = true;
        this.cardFlags.vengeanceLeaders = leaders;
        break;
      }

      this.ui.setStatus(
        forcedDecline
          ? `${this.currentPlayer.name} is the sole leader — can't play Vengeance. Drawing again...`
          : `${this.currentPlayer.name} declines Vengeance. Drawing again...`
      );
      card = await this._drawCard();
    }

    this.applyCardEffect(this.currentCard);
  }

  // Called uniformly on every client as part of the shared drawAndApplyCard
  // flow (unlike roll/hold/bank, there's no "standing loop" for this one --
  // every client is already here at the same logical moment).
  async resolveVengeance(leaders) {
    if (this.currentPlayer.type === "cpu") {
      // A simple heuristic: don't play it if doing so would also dock the CPU.
      // Deterministic given already-synced scores, so every client computes
      // the same answer independently -- no network round trip needed.
      return !leaders.some((p) => p.id === this.currentPlayer.id);
    }
    if (this.isAuthorityForPlayer(this.currentPlayer)) {
      const play = await this.ui.promptVengeance(leaders);
      this.net.broadcast("humanVengeance", { play });
      return play;
    }
    // Someone else's decision to make -- wait for it.
    const { play } = await this.net.next("humanVengeance");
    return play;
  }

  applyCardEffect(card) {
    switch (card.id) {
      case "BONUS_300":
      case "BONUS_400":
      case "BONUS_500":
        this.cardFlags.bonusValue = BONUS_VALUE[card.id];
        this.cardFlags.bonusCredited = false;
        break;
      case "FILL_1000":
        this.cardFlags.fillBonusRemaining = 1;
        break;
      case "MUST_BUST":
        this.cardFlags.mustBust = true;
        break;
      case "DOUBLE_TROUBLE":
        this.cardFlags.doubleTroublePending = 2;
        break;
      case "NO_DICE":
        this.forfeitTurn(
          this.turnScore > 0
            ? `No Dice! ${this.currentPlayer.name} loses all ${this.turnScore} points from this turn.`
            : `No Dice! ${this.currentPlayer.name}'s turn is skipped.`
        );
        return;
      default:
        break;
    }
    this.ui.setRollEnabled(true);
    if (this.currentPlayer.type === "cpu") {
      setTimeout(() => this.rollDice(), cpuThinkDelay());
    }
  }

  async rollDice() {
    if (this.activeIndices.length === 0) return;
    if (!this.isAuthorityForPlayer(this.currentPlayer)) return; // someone else rolls for this turn; the standing "diceRolled" loop applies it here once it arrives
    this.ui.setRollEnabled(false);
    this.ui.setBankEnabled(false);
    this.selected.clear();
    this.ui.clearDiceSelectionUI();

    const results = await this.dice3d.rollIndices(this.activeIndices);
    const indices = this.activeIndices;
    const values = indices.map((i) => results[i]);
    this.net.broadcast("diceRolled", { indices, values });
    await this._afterRoll(indices, values);
  }

  // Applies a roll's outcome -- shared by the client that actually rolled
  // and by every other client replaying the broadcast result.
  async _afterRoll(indices, values) {
    this.rollValues = values;
    this.ui.setDiceFaces(indices, values);

    if (!hasAnyScore(values)) {
      if (this.cardFlags.mustBust) {
        this.handleMustBustPayout();
      } else {
        this.handleBust();
      }
      return;
    }

    this.ui.setStatus(`${this.currentPlayer.name}: pick dice to hold`);
    this.ui.enableDiceSelection(indices);

    if (this.currentPlayer.type === "cpu") {
      setTimeout(() => this.cpuTakeTurn(), cpuThinkDelay());
    }
  }

  // Invoked by the standing "diceRolled" network loop for every roll this
  // client didn't itself perform: replays a real physics roll on this
  // client's own dice3d (same gather/launch/tumble/bounce as a free roll),
  // just forced to land on the already-known values, then applies the same
  // downstream logic as a local roll.
  async applyRemoteRoll(indices, values) {
    const forced = {};
    indices.forEach((idx, k) => (forced[idx] = values[k]));
    await this.dice3d.rollIndices(indices, forced);
    await this._afterRoll(indices, values);
  }

  toggleSelect(index) {
    // CPU dice are never hand-picked (cpuTakeTurn chooses for them), and a
    // human's dice can only be picked from their own connected client.
    if (this.currentPlayer.type === "cpu") return;
    if (!this.isAuthorityForPlayer(this.currentPlayer)) return;
    if (!this.activeIndices.includes(index)) return;
    if (this.selected.has(index)) this.selected.delete(index);
    else this.selected.add(index);
    this.ui.setSelectedDice([...this.selected]);
    this.updatePendingScore();
  }

  updatePendingScore() {
    const values = [...this.selected].map((i) => this.dice3d.dice[i].value);
    const result = scoreSelection(values);
    this.ui.setPendingScore(result);
    return result;
  }

  // Only ever called from a button click on the client that owns the
  // current turn (see toggleSelect's guard) -- broadcasts the choice so
  // every other client's standing "humanHeld" loop can replay it, then
  // applies it locally via the same commitHold every path funnels through.
  confirmHold() {
    const values = [...this.selected].map((i) => this.dice3d.dice[i].value);
    if (values.length === 0) return;
    const result = scoreSelection(values);
    if (!result.valid) {
      this.ui.setStatus("That selection doesn't form a valid score — pick again.");
      return;
    }
    const indices = [...this.selected];
    this.net.broadcast("humanHeld", { indices });
    this.commitHold(indices, result.score);
  }

  commitHold(indices, score) {
    this.turnScore += score;
    this.dice3d.holdDice(indices);
    this.activeIndices = this.activeIndices.filter((i) => !indices.includes(i));
    this.selected.clear();
    this.ui.clearDiceSelectionUI();
    this.ui.setTurnScore(this.turnScore);
    this.ui.setHeld(this.dice3d.dice.filter((d) => d.state === "tray").map((d) => d.value));
    this.ui.syncDiceState(this.dice3d.dice);

    if (this.activeIndices.length === 0) {
      this.handleFill();
      return;
    }

    const canBank = !this.bankBlocked();
    this.ui.setRollEnabled(true);
    this.ui.setBankEnabled(canBank);
    this.ui.setStatus(
      canBank
        ? `${this.currentPlayer.name}: roll again or bank`
        : `${this.currentPlayer.name}: must keep rolling`
    );

    if (this.currentPlayer.type === "cpu") {
      const bank =
        canBank &&
        cpuShouldBank({
          turnScore: this.turnScore,
          diceRemaining: this.activeIndices.length,
          currentTotal: this.currentPlayer.score,
          targetScore: this.targetScore,
          difficulty: this.currentPlayer.difficulty,
        });
      setTimeout(() => (bank ? this.bank() : this.rollDice()), cpuThinkDelay());
    }
  }

  // A FILL means every die scored across this roll sequence. Resolve any
  // card conditions that key off a FILL, then either let the player choose
  // to continue or bank (normal case), or force a continuation with no real
  // choice to make (Must Bust / Double Trouble mid-sequence).
  async handleFill() {
    this.hasFilledThisTurn = true;

    // Credit a BONUS card's points as soon as the FILL that earns them
    // happens, not just at bank time -- so the Turn Score display reflects
    // it immediately even if the player keeps rolling afterward.
    if (this.cardFlags.bonusValue && !this.cardFlags.bonusCredited) {
      this.turnScore += this.cardFlags.bonusValue;
      this.cardFlags.bonusCredited = true;
    }

    if (this.cardFlags.fillBonusRemaining > 0) {
      this.cardFlags.fillBonusRemaining = 0;
      this.turnScore += 1000;
    }

    if (this.cardFlags.vengeancePending) {
      this.currentPlayer.score += this.turnScore;
      for (const leader of this.cardFlags.vengeanceLeaders) {
        leader.score = Math.max(0, leader.score - 2500);
      }
      this.turnScore = 0;
      this.cardFlags.vengeancePending = false;
      this.cardFlags.vengeanceLeaders = [];
      this.ui.renderPlayers(this.players, this.currentPlayerIndex);
    }

    if (this.cardFlags.doubleTroublePending > 0) {
      this.cardFlags.doubleTroublePending--;
      if (this.cardFlags.doubleTroublePending === 0) {
        this.currentPlayer.score += this.turnScore * 2;
        this.turnScore = 0;
        this.ui.renderPlayers(this.players, this.currentPlayerIndex);
      }
    }

    this.ui.setTurnScore(this.turnScore);
    this.ui.setRollEnabled(false);

    if (this.bankBlocked()) {
      this.ui.setBankEnabled(false);
      this.ui.setStatus(`${this.currentPlayer.name}: FILL! Must keep rolling...`);
      setTimeout(() => this.continueAfterFill(), 900);
      return;
    }

    this.ui.setBankEnabled(true);
    this.ui.setStatus(`${this.currentPlayer.name}: FILL! Draw again or bank`);
    this.ui.setFillPromptEnabled(true);

    if (this.currentPlayer.type === "cpu") {
      setTimeout(() => this.continueAfterFill(), cpuThinkDelay());
    }
  }

  async continueAfterFill() {
    this.ui.setFillPromptEnabled(false);
    this.activeIndices = [0, 1, 2, 3, 4, 5];
    this.dice3d.resetAll();
    this.ui.setHeld([]);
    this.ui.syncDiceState(this.dice3d.dice);
    this.ui.resetDiceFaces();

    if (this.cardFlags.mustBust) {
      // "You do not draw another card after each FILL when playing Must Bust."
      this.ui.setRollEnabled(true);
      if (this.currentPlayer.type === "cpu") {
        setTimeout(() => this.rollDice(), cpuThinkDelay());
      }
      return;
    }

    await this.drawAndApplyCard();
  }

  // Only ever called from the "Draw & Roll Again" button on the client that
  // owns the current turn -- broadcasts the choice for the standing
  // "humanContinue" loop on every other client, then applies it locally.
  // CPU turns and forced (no-real-choice) continuations call the plain
  // continueAfterFill() directly instead, since there's no decision to relay.
  humanContinueAfterFill() {
    this.net.broadcast("humanContinue", {});
    this.continueAfterFill();
  }

  cpuTakeTurn() {
    const values = this.activeIndices.map((i) => this.dice3d.dice[i].value);
    const bestLocal = bestSelection(values);
    const indices = bestLocal.map((li) => this.activeIndices[li]);
    const heldValues = indices.map((i) => this.dice3d.dice[i].value);
    const result = scoreSelection(heldValues);
    if (!result.valid || indices.length === 0) {
      if (this.cardFlags.mustBust) {
        this.handleMustBustPayout();
      } else {
        this.handleBust();
      }
      return;
    }
    this.commitHold(indices, result.score);
  }

  async handleBust() {
    this.ui.setStatus(`${this.currentPlayer.name} BUSTED! Lost ${this.turnScore} points.`);
    this.turnScore = 0;
    await this.ui.showBustStamp();
    this.endTurn({ busted: true });
  }

  // Must Bust inverts the usual bust penalty: whatever was earned this turn
  // (any BONUS card was already credited into turnScore at FILL time) is
  // paid out instead of lost.
  handleMustBustPayout() {
    const score = this.turnScore;
    this.currentPlayer.score += score;
    this.turnScore = 0;
    this.ui.setStatus(`${this.currentPlayer.name} busts, but Must Bust protects the ${score} points earned!`);
    this.ui.renderPlayers(this.players, this.currentPlayerIndex);
    this.endTurn({ busted: false });
  }

  // Used for NO_DICE: forfeits any unbanked turn points (points already on
  // the scoresheet from an earlier FILL/Vengeance/Double Trouble payout this
  // turn are unaffected) and ends the turn immediately.
  async forfeitTurn(message) {
    this.ui.setStatus(message);
    this.turnScore = 0;
    await this.ui.showNoDiceStamp();
    this.endTurn({ busted: true });
  }

  bank() {
    // Any BONUS card was already credited into turnScore at FILL time.
    this.currentPlayer.score += this.turnScore;
    this.turnScore = 0;
    this.ui.renderPlayers(this.players, this.currentPlayerIndex);
    this.endTurn({ busted: false });
  }

  // Only ever called from the Bank Points button on the client that owns the
  // current turn -- broadcasts the choice for the standing "humanBank" loop
  // on every other client, then applies it locally via the same bank()
  // CPU turns call directly (their bank-or-continue decision is deterministic,
  // so it needs no network relay).
  humanBank() {
    this.net.broadcast("humanBank", {});
    this.bank();
  }

  endTurn({ busted, skipped }) {
    this.ui.setRollEnabled(false);
    this.ui.setBankEnabled(false);
    this.ui.setFillPromptEnabled(false);
    this.ui.clearDiceSelectionUI();

    if (!this.finalRoundTriggered && this.currentPlayer.score >= this.targetScore) {
      this.finalRoundTriggered = true;
      this.finalRoundStarter = this.currentPlayerIndex;
    }

    const nextIndex = (this.currentPlayerIndex + 1) % this.players.length;
    if (this.finalRoundTriggered && nextIndex === this.finalRoundStarter) {
      this.finishGame();
      return;
    }

    this.currentPlayerIndex = nextIndex;
    setTimeout(() => this.startTurn(), 900);
  }

  finishGame() {
    this.gameOver = true;
    const winner = this.players.reduce((a, b) => (b.score > a.score ? b : a));
    this.ui.setStatus(`Game over! ${winner.name} wins with ${winner.score} points!`);
    this.ui.renderPlayers(this.players, -1);
    this.ui.showGameOver(winner, this.players);
  }
}
