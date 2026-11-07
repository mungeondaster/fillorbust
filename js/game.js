import { Dice3D } from "./dice3d.js?v=45";
import { CardTable } from "./cardsUI.js?v=45";
import { Deck } from "./deck.js?v=45";
import { scoreSelection, hasAnyScore, bestSelection } from "./scoring.js?v=45";
import { cpuShouldBank, cpuThinkDelay } from "./ai.js?v=45";
import { LocalNet } from "./movelog.js?v=45";
import { playBank, playBust, sfx, setSoundGate } from "./sound.js?v=45";
import { playCardStinger } from "./stingers.js?v=45";

const BONUS_VALUE = { BONUS_300: 300, BONUS_400: 400, BONUS_500: 500 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Small fast seeded PRNG: the same seed gives the same sequence on every device.
function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mix = (a, b) => (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)) >>> 0;
const rollDie = (rng = Math.random) => 1 + Math.floor(rng() * 6);

// How the game stays in sync online
// ---------------------------------
// Every device runs this same Game as a pure function of the start settings
// (players, target, seed) plus an ordered log of human decisions (see
// net.js). One turn is one pass through playTurn(); whenever a human has to
// decide something, decide() takes the next entry from the log -- writing it
// first if the decision is this device's to make. CPU seats never touch the
// log: their dice come from the shared seed and their choices are
// deterministic, so every device computes them identically. At the end of
// every turn all devices also meet at a "turnEnd" entry, which is what lets a
// device that fell behind (screen locked, refreshed, slow connection) notice
// and fast-forward: whenever the log already holds entries past the one this
// device is working on, it skips animations, pauses and sound until it's
// caught up.
export class Game {
  // net: a NetSession for online play, or omitted for single-device play.
  // myPlayerId: this device's own seat index online; null on a single device
  // (where every human seat is "mine").
  constructor({ diceContainer, cardContainer, players, targetScore, ui, net, myPlayerId, seed }) {
    this.dice3d = new Dice3D(diceContainer);
    this.cardTable = new CardTable(cardContainer);
    this.seed = (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
    this.deck = new Deck(mulberry32(this.seed));
    this.cardTable.render(this.deck);

    this.players = players.map((p, i) => ({ ...p, id: i, score: 0, cpuControlled: false }));
    this.targetScore = targetScore;
    this.ui = ui;
    this.net = net ?? new LocalNet();
    this.myPlayerId = myPlayerId ?? null;

    this.consumed = 0; // how many log entries this device has applied
    this.turnNo = 0;
    this.currentPlayerIndex = 0;
    this.turnScore = 0;
    this.activeIndices = [0, 1, 2, 3, 4, 5];
    this.selected = new Set();
    this.currentCard = null;
    this.cardFlags = this._freshCardFlags();
    this.finalRoundTriggered = false;
    this.finalRoundStarter = null;
    this.gameOver = false;
    this.awaitingSeat = null; // seat whose decision we're waiting on from another device
    this._ask = null; // the decision currently offered to this device's player
    this._reclaimSent = false;

    setSoundGate(() => !this.fast);
    this.done = this.run().catch((err) => {
      console.error(err);
      this.ui.setStatus("Something went wrong. Refresh the page to rejoin.");
    });
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  // Behind the log: catch up without animations, pauses or sound.
  // (Also while the page is hidden: a background tab gets no animation
  // frames, and nobody should have to wait on a player who switched apps.)
  get fast() {
    return this.net.logLength > this.consumed || document.hidden;
  }

  pause(ms) {
    return this.fast ? Promise.resolve() : wait(ms);
  }

  isCpuSeat(p) {
    return p.type === "cpu" || p.cpuControlled;
  }

  // A human seat this device's player acts for.
  isLocalSeat(p) {
    return !!p && !this.isCpuSeat(p) && (this.myPlayerId === null || p.id === this.myPlayerId);
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

  // ---------------- Main loop ----------------

  async run() {
    await this.net.openLog();
    while (!this.gameOver) {
      await this.playTurn();
      this._disableControls();

      if (!this.finalRoundTriggered && this.currentPlayer.score >= this.targetScore) {
        this.finalRoundTriggered = true;
        this.finalRoundStarter = this.currentPlayerIndex;
      }
      const nextIndex = (this.currentPlayerIndex + 1) % this.players.length;
      if (this.finalRoundTriggered && nextIndex === this.finalRoundStarter) {
        this.finishGame();
        return;
      }

      await this.syncTurnEnd();
      this.currentPlayerIndex = nextIndex;
      this.turnNo++;
      await this.pause(900);
    }
  }

  // One full turn. Returns when the turn is over (banked, bust, No Dice...).
  async playTurn() {
    this.turnScore = 0;
    this.activeIndices = [0, 1, 2, 3, 4, 5];
    this.selected.clear();
    this.cardFlags = this._freshCardFlags();
    this.turnRng = mulberry32(mix(this.seed, this.turnNo + 1)); // CPU dice for this turn
    this.dice3d.resetAll();
    this.ui.syncDiceState(this.dice3d.dice);
    this.ui.resetDiceFaces();
    this.ui.setStatus(`${this.currentPlayer.name}'s turn`);
    this.ui.renderPlayers(this.players, this.currentPlayerIndex);
    this.ui.setTurnScore(0);
    this.ui.setHeld([]);
    this._disableControls();

    if (!(await this.drawCardPhase())) return;

    let mayBank = false; // only after at least one hold since the last card
    for (;;) {
      const r = await this.decide(mayBank && !this.bankBlocked() ? ["roll", "bank"] : ["roll"]);
      if (r.type === "bank") return this.bank();

      if (!(await this.doRoll(r.values))) return; // bust ends the turn

      const h = await this.decide(["hold"]);
      this.commitHold(h.indices);
      if (this.activeIndices.length > 0) {
        mayBank = true;
        continue;
      }

      // FILL: every die has scored.
      this.handleFill();
      if (this.bankBlocked()) {
        await this.pause(900); // no real choice -- keep going
      } else {
        const c = await this.decide(["continue", "bank"]);
        if (c.type === "bank") return this.bank();
      }
      this.resetForContinue();
      // "You do not draw another card after each FILL when playing Must Bust."
      if (!this.cardFlags.mustBust && !(await this.drawCardPhase())) return;
      mayBank = false;
    }
  }

  // ---------------- Decisions ----------------

  // Gets the current player's next decision, one of `types`:
  //   roll {values} | bank | hold {indices} | continue | vengeance {play}
  // CPU seats decide locally (deterministic). Human seats always come from
  // the log; if it's this device's player and nothing is waiting in the log,
  // the choice is offered on screen and written to the log first.
  async decide(types) {
    for (;;) {
      this._maybeReclaimSeat();
      const p = this.currentPlayer;
      if (this.isCpuSeat(p)) {
        await this.pause(cpuThinkDelay());
        return this._cpuDecide(types);
      }

      if (this.net.logLength <= this.consumed) {
        if (this.isLocalSeat(p)) {
          const choice = await this._askLocal(types);
          if (choice) {
            const ok = await this.net.submit(this.consumed, { ...choice, turn: this.turnNo, seat: p.id });
            if (!ok && this.net.logLength <= this.consumed) {
              this.ui.setStatus("Couldn't send that move — try again.");
              continue;
            }
          }
        } else {
          this.awaitingSeat = p.id; // another device's move (main.js shows a waiting banner)
        }
      }

      const ev = await this.net.waitFor(this.consumed);
      this.consumed++;
      this.awaitingSeat = null;
      if (ev.type === "seat") {
        this._applySeat(ev);
        continue;
      }
      if (ev.turn === this.turnNo && ev.seat === p.id && types.includes(ev.type) && this._valid(ev)) return ev;
      console.warn("Ignoring out-of-place move", ev);
    }
  }

  _valid(ev) {
    switch (ev.type) {
      case "roll":
        return (
          Array.isArray(ev.values) &&
          ev.values.length === this.activeIndices.length &&
          ev.values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)
        );
      case "hold": {
        const idx = ev.indices;
        if (!Array.isArray(idx) || idx.length === 0) return false;
        if (new Set(idx).size !== idx.length || !idx.every((i) => this.activeIndices.includes(i))) return false;
        return scoreSelection(idx.map((i) => this.dice3d.dice[i].value)).valid;
      }
      case "vengeance":
        return typeof ev.play === "boolean";
      default:
        return true; // bank / continue
    }
  }

  _cpuDecide(types) {
    const p = this.currentPlayer;
    if (types.includes("vengeance")) {
      // Don't play it if it would also dock the CPU itself.
      return { type: "vengeance", play: !this._vengeanceLeaders.some((l) => l.id === p.id) };
    }
    if (types.includes("hold")) {
      const values = this.activeIndices.map((i) => this.dice3d.dice[i].value);
      return { type: "hold", indices: bestSelection(values).map((li) => this.activeIndices[li]) };
    }
    if (types.includes("continue")) return { type: "continue" };
    if (
      types.includes("bank") &&
      cpuShouldBank({
        turnScore: this.turnScore,
        diceRemaining: this.activeIndices.length,
        currentTotal: p.score,
        targetScore: this.targetScore,
        difficulty: p.difficulty ?? "normal",
      })
    ) {
      return { type: "bank" };
    }
    return { type: "roll", values: this.activeIndices.map(() => rollDie(this.turnRng)) };
  }

  // Offers the decision on screen. Resolves with the player's choice, or
  // null if an entry shows up in the log first (e.g. someone handed this
  // seat to the CPU while it looked disconnected).
  _askLocal(types) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (choice) => {
        if (settled) return;
        settled = true;
        this._ask = null;
        this._disableControls();
        resolve(choice);
      };
      this._ask = { types, finish };

      if (types.includes("roll")) this.ui.setRollEnabled(true);
      if (types.includes("bank")) this.ui.setBankEnabled(true);
      if (types.includes("continue")) this.ui.setFillPromptEnabled(true);
      if (types.includes("hold")) this.ui.enableDiceSelection(this.activeIndices);
      if (types.includes("vengeance")) {
        this.ui.promptVengeance(this._vengeanceLeaders).then((play) => {
          if (play !== null) finish({ type: "vengeance", play });
        });
      }
      this.net.waitFor(this.consumed).then(() => finish(null));
    });
  }

  _disableControls() {
    this.ui.setRollEnabled(false);
    this.ui.setBankEnabled(false);
    this.ui.setFillPromptEnabled(false);
    this.ui.clearDiceSelectionUI();
    this.ui.cancelVengeance?.();
    this.selected.clear();
  }

  // ---- button handlers (main.js) ----

  rollDice() {
    const a = this._ask;
    if (!a || !a.types.includes("roll")) return;
    a.finish({ type: "roll", values: this.activeIndices.map(() => rollDie()) });
  }

  humanBank() {
    const a = this._ask;
    if (!a || !a.types.includes("bank")) return;
    a.finish({ type: "bank" });
  }

  humanContinueAfterFill() {
    const a = this._ask;
    if (!a || !a.types.includes("continue")) return;
    a.finish({ type: "continue" });
  }

  toggleSelect(index) {
    const a = this._ask;
    if (!a || !a.types.includes("hold")) return;
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

  confirmHold() {
    const a = this._ask;
    if (!a || !a.types.includes("hold")) return;
    const indices = [...this.selected].sort((x, y) => x - y);
    if (indices.length === 0) return;
    if (!scoreSelection(indices.map((i) => this.dice3d.dice[i].value)).valid) {
      this.ui.setStatus("That selection doesn't form a valid score — pick again.");
      return;
    }
    a.finish({ type: "hold", indices });
  }

  // ---- seats handed to the CPU (and back) ----

  // Anyone may hand a disconnected player's seat to the CPU so the game can
  // go on; it's handed back automatically when that player returns.
  takeOverSeat(seat) {
    return this.net.append({ type: "seat", seat, cpu: true });
  }

  _maybeReclaimSeat() {
    const me = this.myPlayerId === null ? null : this.players[this.myPlayerId];
    if (!me || !me.cpuControlled || this.fast || this._reclaimSent || me.type === "cpu") return;
    this._reclaimSent = true;
    this.net.append({ type: "seat", seat: me.id, cpu: false });
  }

  _applySeat(ev) {
    const p = this.players[ev.seat];
    if (!p || p.type === "cpu") return;
    p.cpuControlled = !!ev.cpu;
    if (ev.seat === this.myPlayerId) this._reclaimSent = false;
    this.ui.renderPlayers(this.players, this.currentPlayerIndex);
    if (!this.fast) {
      this.ui.setStatus(ev.cpu ? `The CPU is playing for ${p.name} for now` : `${p.name} is back!`);
    }
  }

  // Every device meets here between turns (see the class comment).
  async syncTurnEnd() {
    for (;;) {
      this._maybeReclaimSeat();
      if (this.net.logLength <= this.consumed) {
        await this.net.submit(this.consumed, { type: "turnEnd", turn: this.turnNo });
      }
      const ev = await this.net.waitFor(this.consumed);
      this.consumed++;
      if (ev.type === "seat") {
        this._applySeat(ev);
        continue;
      }
      if (ev.type === "turnEnd" && ev.turn === this.turnNo) return;
      console.warn("Ignoring out-of-place move", ev);
    }
  }

  // ---------------- Cards ----------------

  async drawCard() {
    if (this.deck.needsReshuffle && !this.fast) await this.cardTable.playShuffleAnimation();
    return this.deck.draw();
  }

  // Draws the turn's governing card. A VENGEANCE draw is a detour: the
  // player may decline (or must, if they're the sole leader), in which case
  // a replacement is drawn. Returns false if the card ended the turn.
  async drawCardPhase() {
    let card = await this.drawCard();
    for (;;) {
      this.currentCard = card;
      await this.cardTable.draw(card, this.deck, this.fast);
      playCardStinger(card.id); // dramatic cards get a musical sting on reveal

      if (card.id !== "VENGEANCE") break;

      const leaders = this.computeLeaders();
      const forcedDecline = leaders.length === 1 && leaders[0].id === this.currentPlayer.id;
      let play = false;
      if (!forcedDecline) {
        this._vengeanceLeaders = leaders;
        this.ui.setStatus(`${this.currentPlayer.name} drew Vengeance...`);
        play = (await this.decide(["vengeance"])).play;
      }
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
      card = await this.drawCard();
    }
    return this.applyCardEffect(this.currentCard);
  }

  async applyCardEffect(card) {
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
        await this.forfeitTurn(
          this.turnScore > 0
            ? `No Dice! ${this.currentPlayer.name} loses all ${this.turnScore} points from this turn.`
            : `No Dice! ${this.currentPlayer.name}'s turn is skipped.`
        );
        return false;
      default:
        break;
    }
    this.ui.setStatus(`${this.currentPlayer.name}: roll the dice`);
    return true;
  }

  // ---------------- Dice ----------------

  // Shows a roll and applies it. Returns false if it busted the turn.
  async doRoll(values) {
    const indices = [...this.activeIndices];
    this._disableControls();
    const forced = {};
    indices.forEach((idx, k) => (forced[idx] = values[k]));
    await this.dice3d.rollIndices(indices, forced, this.fast);
    this.ui.setDiceFaces(indices, values);

    if (!hasAnyScore(values)) {
      if (this.cardFlags.mustBust) this.handleMustBustPayout();
      else await this.handleBust();
      return false;
    }
    this.ui.setStatus(`${this.currentPlayer.name}: pick dice to hold`);
    return true;
  }

  commitHold(indices) {
    const score = scoreSelection(indices.map((i) => this.dice3d.dice[i].value)).score;
    this.turnScore += score;
    this.dice3d.holdDice(indices, this.fast);
    this.activeIndices = this.activeIndices.filter((i) => !indices.includes(i));
    this.selected.clear();
    this.ui.clearDiceSelectionUI();
    this.ui.setTurnScore(this.turnScore);
    this.ui.setHeld(this.dice3d.dice.filter((d) => d.state === "tray").map((d) => d.value));
    this.ui.syncDiceState(this.dice3d.dice);
    if (this.activeIndices.length > 0) {
      this.ui.setStatus(
        this.bankBlocked()
          ? `${this.currentPlayer.name}: must keep rolling`
          : `${this.currentPlayer.name}: roll again or bank`
      );
    }
  }

  // A FILL means every die scored across this roll sequence. Resolves any
  // card conditions that key off a FILL.
  handleFill() {
    sfx("chipsHandle", { vol: 0.9 });

    // Credit a BONUS card's points as soon as the FILL that earns them
    // happens, not just at bank time.
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
    this.ui.setStatus(
      this.bankBlocked()
        ? `${this.currentPlayer.name}: FILL! Must keep rolling...`
        : `${this.currentPlayer.name}: FILL! Draw again or bank`
    );
  }

  resetForContinue() {
    this.activeIndices = [0, 1, 2, 3, 4, 5];
    this.dice3d.resetAll();
    this.ui.setHeld([]);
    this.ui.syncDiceState(this.dice3d.dice);
    this.ui.resetDiceFaces();
  }

  // ---------------- Turn endings ----------------

  async handleBust() {
    this.ui.setStatus(`${this.currentPlayer.name} BUSTED! Lost ${this.turnScore} points.`);
    this.turnScore = 0;
    playBust();
    if (!this.fast) await this.ui.showBustStamp();
  }

  // Must Bust inverts the usual bust penalty: whatever was earned this turn
  // is paid out instead of lost.
  handleMustBustPayout() {
    const score = this.turnScore;
    playBank(score);
    this.currentPlayer.score += score;
    this.turnScore = 0;
    this.ui.setStatus(`${this.currentPlayer.name} busts, but Must Bust protects the ${score} points earned!`);
    this.ui.renderPlayers(this.players, this.currentPlayerIndex);
  }

  // NO_DICE: forfeits any unbanked turn points (points already on the
  // scoresheet from an earlier payout this turn are unaffected).
  async forfeitTurn(message) {
    this.ui.setStatus(message);
    this.turnScore = 0;
    if (!this.fast) await this.ui.showNoDiceStamp();
  }

  bank() {
    playBank(this.turnScore);
    this.currentPlayer.score += this.turnScore;
    this.turnScore = 0;
    this.ui.setTurnScore(0);
    this.ui.renderPlayers(this.players, this.currentPlayerIndex);
  }

  finishGame() {
    this.gameOver = true;
    const winner = this.players.reduce((a, b) => (b.score > a.score ? b : a));
    this.ui.setStatus(`Game over! ${winner.name} wins with ${winner.score} points!`);
    this.ui.renderPlayers(this.players, -1);
    this.ui.showGameOver(winner, this.players);
  }
}
