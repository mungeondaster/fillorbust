import { sfx } from "./sound.js?v=55";
import { cardFaceSVG, cardBackSVG } from "./cardArt.js?v=55";

// The printed face of a card (falls back to its name in plain text).
function faceMarkup(card) {
  return cardFaceSVG(card) ?? `<div class="card-title">${card.label}</div>`;
}

// Renders the draw pile / discard pile / active card as authentic-looking
// physical playing cards: slightly uneven stacking, soft shadows, a flip
// animation on draw.

function seededOffset(seed) {
  // deterministic pseudo-random jitter per stack layer, so piles look
  // consistently "messy" rather than reshuffling their jitter every render
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  const frac = x - Math.floor(x);
  return frac;
}

function buildStackLayers(container, count, cls, topCard) {
  container.innerHTML = "";
  const layers = Math.min(count, 7);
  for (let i = 0; i < layers; i++) {
    const layer = document.createElement("div");
    layer.className = `card-layer ${cls}`;
    const rot = (seededOffset(i + 1) - 0.5) * 6;
    const dx = (seededOffset(i + 7) - 0.5) * 5;
    const dy = -i * 1.1;
    layer.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
    layer.style.zIndex = String(i);
    if (cls === "back") {
      layer.innerHTML = cardBackSVG();
    } else if (topCard && i === layers - 1) {
      layer.classList.add("card-layer-labeled");
      layer.innerHTML = faceMarkup(topCard);
    }
    container.appendChild(layer);
  }
  return layers;
}

export class CardTable {
  constructor(root) {
    this.root = root;
    // Layout (grid areas, see style.css): title, the card in play, its rule
    // spelled out (no hover needed -- phones can't hover), then the piles.
    this.root.innerHTML = `
      <div class="panel-title"><span>Card in Play</span></div>
      <div class="pile-wrap draw">
        <div class="pile-label">Draw</div>
        <div class="draw-stack pile" id="drawStack"></div>
        <div class="pile-count" id="drawCount">0</div>
      </div>
      <div class="active-slot" id="activeSlot">
        <div class="card-slide" id="cardSlide">
          <div class="flip-card" id="flipCard">
            <div class="flip-inner">
              <div class="card-face card-back">${cardBackSVG()}</div>
              <div class="card-face card-front" id="cardFront"></div>
            </div>
          </div>
        </div>
        <span class="rule-badge" aria-hidden="true">i</span>
        <div class="card-rule" id="cardRule" role="tooltip"></div>
      </div>
      <div class="pile-wrap discard">
        <div class="pile-label">Discard</div>
        <div class="discard-stack pile" id="discardStack"></div>
        <div class="pile-count" id="discardCount">0</div>
      </div>
    `;
    this.drawStack = this.root.querySelector("#drawStack");
    this.discardStack = this.root.querySelector("#discardStack");
    this.drawCount = this.root.querySelector("#drawCount");
    this.discardCount = this.root.querySelector("#discardCount");
    this.cardSlide = this.root.querySelector("#cardSlide");
    this.flipCard = this.root.querySelector("#flipCard");
    this.flipInner = this.root.querySelector(".flip-inner");
    this.cardFront = this.root.querySelector("#cardFront");
    this.cardRule = this.root.querySelector("#cardRule");
    this.activeSlot = this.root.querySelector("#activeSlot");

    // What the card does: shown on hover (mouse) or by tapping the card
    // (phones); a tap anywhere else, or a few seconds, hides it again.
    let hideTimer = 0;
    const hide = () => { clearTimeout(hideTimer); this.activeSlot.classList.remove("show-rule"); };
    this.activeSlot.tabIndex = 0;
    this.activeSlot.setAttribute("aria-describedby", "cardRule");
    this.activeSlot.addEventListener("click", () => {
      if (!this.cardRule.textContent) return;
      if (this.activeSlot.classList.toggle("show-rule")) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 6000);
      }
    });
    document.addEventListener("pointerdown", (e) => {
      if (!this.activeSlot.contains(e.target)) hide();
    });
    this._hideRule = hide;
  }

  render(deck) {
    buildStackLayers(this.drawStack, deck.drawPile.length, "back");
    const lastDiscard = deck.discardPile[deck.discardPile.length - 1];
    buildStackLayers(
      this.discardStack,
      deck.discardPile.length,
      "discard-face",
      lastDiscard
    );
    this.drawCount.textContent = String(deck.drawPile.length);
    this.discardCount.textContent = String(deck.discardPile.length);
  }

  // Offset (in px) from `fromEl`'s center to `toEl`'s center -- used to slide
  // the active card between the draw pile / center / discard pile without
  // reflowing layout (a plain CSS transform).
  _offsetBetween(fromEl, toEl) {
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    return {
      dx: a.left + a.width / 2 - (b.left + b.width / 2),
      dy: a.top + a.height / 2 - (b.top + b.height / 2),
    };
  }

  async draw(card, deck, instant = false) {
    if (instant) {
      // Catching up on missed moves: just show the result.
      this.cardSlide.style.transition = "none";
      this.cardSlide.style.transform = "translate(0px, 0px) scale(1) rotate(0deg)";
      this.cardSlide.style.opacity = "1";
      this.flipInner.style.transition = "none";
      this.cardFront.innerHTML = faceMarkup(card);
      this.cardFront.title = card.desc;
      this.cardFront.dataset.type = card.id;
      this.flipCard.classList.add("flipped");
      void this.cardSlide.offsetWidth;
      this.flipInner.style.transition = "";
      this.cardRule.textContent = card.desc;
      this.cardRule.classList.remove("fading");
      this.render(deck);
      return;
    }
    const hadPreviousCard = !!this.cardFront.dataset.type;
    this._hideRule();
    this.cardRule.classList.add("fading");

    if (hadPreviousCard) {
      // Slide the card that was showing off toward the discard pile before
      // bringing in the new one.
      const { dx, dy } = this._offsetBetween(this.discardStack, this.cardSlide);
      sfx("cardShove", { vol: 0.6 });
      this.cardSlide.style.transition = "transform 0.45s cubic-bezier(0.4, 0, 0.6, 1), opacity 0.4s ease-in";
      this.cardSlide.style.transform = `translate(${dx}px, ${dy}px) scale(0.8) rotate(-8deg)`;
      this.cardSlide.style.opacity = "0";
      await wait(450);
      // The deck already moved that card into discardPile -- reflect it now,
      // right as it visually lands there.
      this.render(deck);
    }

    // Snap (no transition) to the draw pile's position, face-down. The
    // offset must be measured from cardSlide's neutral (centered) position,
    // not wherever it was just left mid-discard-animation, or the distance
    // ends up doubled and the card appears to fly in from way off-screen.
    this.cardSlide.style.transition = "none";
    this.cardSlide.style.transform = "translate(0px, 0px) scale(1) rotate(0deg)";
    const { dx: sx, dy: sy } = this._offsetBetween(this.drawStack, this.cardSlide);
    this.cardSlide.style.transform = `translate(${sx}px, ${sy}px) scale(0.82)`;
    this.cardSlide.style.opacity = "1";
    // .flip-inner has its own CSS transition for the flip itself; disable it
    // here too so un-flipping to face-down is instant (invisible) instead of
    // visibly rotating through the old card's face while we reposition.
    this.flipInner.style.transition = "none";
    this.flipCard.classList.remove("flipped");
    void this.cardSlide.offsetWidth; // force reflow so all of the above lands instantly
    this.flipInner.style.transition = ""; // restore for the real reveal flip later

    // Slide it from the draw pile out to the center.
    sfx("cardSlide", { vol: 0.75 });
    this.cardSlide.style.transition = "transform 0.4s cubic-bezier(0.2, 0.7, 0.3, 1)";
    this.cardSlide.style.transform = "translate(0, 0) scale(1) rotate(0deg)";
    await wait(400);

    this.cardFront.innerHTML = faceMarkup(card);
    this.cardFront.title = card.desc;
    this.cardFront.dataset.type = card.id;
    await wait(80);
    this.flipCard.classList.add("flipped");
    setTimeout(() => sfx("cardPlace", { vol: 0.8 }), 220); // lands as the flip finishes
    await wait(300);
    this.cardRule.textContent = card.desc;
    this.cardRule.classList.remove("fading");
    await wait(200);
    this.render(deck);
  }

  // Played when the draw pile runs out and the discards are shuffled back
  // in -- a quick shake/glow on both piles so it reads as a deliberate
  // reshuffle rather than the counts just silently jumping.
  async playShuffleAnimation() {
    this.flipCard.classList.remove("flipped");
    sfx("shuffle", { vol: 0.8, rate: 1.15 });
    this.drawStack.classList.add("shuffling");
    this.discardStack.classList.add("shuffling");
    await wait(650);
    this.drawStack.classList.remove("shuffling");
    this.discardStack.classList.remove("shuffling");
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
