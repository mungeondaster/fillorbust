import { buildDeck } from "./constants.js?v=59";

export class Deck {
  // rng: a seeded generator shared by every player's device (see game.js),
  // so everyone's deck shuffles -- and reshuffles -- into the same order.
  constructor(rng = Math.random) {
    this.rng = rng;
    this.drawPile = buildDeck();
    this.discardPile = [];
    // The card currently "in play" -- it isn't moved to the discard pile
    // until play moves on to a new card (see draw() below).
    this.activeCard = null;
    this.shuffle();
  }

  shuffle() {
    for (let i = this.drawPile.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [this.drawPile[i], this.drawPile[j]] = [this.drawPile[j], this.drawPile[i]];
    }
  }

  // Draw the next card. Whatever was previously in play only becomes
  // discard now, at the moment play moves on to a new card -- not the
  // instant it was drawn. If the draw pile is empty, automatically shuffle
  // the discard pile back in first (a soft "reshuffle").
  draw() {
    if (this.activeCard) {
      this.discardPile.push(this.activeCard);
      this.activeCard = null;
    }
    if (this.drawPile.length === 0) {
      this.reshuffleDiscards();
    }
    const card = this.drawPile.pop() ?? null;
    this.activeCard = card;
    return card;
  }

  reshuffleDiscards() {
    if (this.discardPile.length === 0) return;
    this.drawPile = this.drawPile.concat(this.discardPile);
    this.discardPile = [];
    this.shuffle();
  }

  // True when the very next draw() will need to reshuffle the discards in
  // first -- lets the caller play a shuffle animation before it happens.
  get needsReshuffle() {
    return this.drawPile.length === 0 && this.discardPile.length > 0;
  }

  get remaining() {
    return this.drawPile.length;
  }
}
