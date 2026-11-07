// Card faces, redrawn as vector art after the printed Fill or Bust deck:
// heavy condensed lettering (the free "Anton" font), black/red/white, and
// most cards mirrored top-to-bottom like real playing cards. SVG so they're
// crisp at every size, from the phone strip to the desktop panel.
//
// cardFaceSVG(card) -> markup for one face on a 250 x 350 canvas.

const W = 250;
const H = 350;
const RED = "#d8203a";
const BLACK = "#111";
const WHITE = "#fff";
const FONT = "Anton, Impact, 'Arial Narrow', sans-serif";
const CAP = 0.87; // Anton's capital height as a fraction of its font size

// One line of lettering, squeezed or stretched to exactly fill a box:
// capitals from `top` down `h` units, `w` units wide, centred on `cx`.
function word(str, { top, h, w, cx = W / 2, fill = WHITE, stroke = null, sw = 0 }) {
  const size = h / CAP;
  const outline = stroke
    ? ` stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke"`
    : "";
  return (
    `<text x="${cx}" y="${top + h}" font-family="${FONT}" font-size="${size.toFixed(1)}" ` +
    `text-anchor="middle" textLength="${w}" lengthAdjust="spacingAndGlyphs" fill="${fill}"${outline}>${str}</text>`
  );
}

// The same artwork again, upside down (bottom half of a mirrored card).
const mirrored = (inner) => `${inner}<g transform="rotate(180 ${W / 2} ${H / 2})">${inner}</g>`;

const svg = (body, label) =>
  `<svg class="card-art" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">${body}</svg>`;

const bg = (fill) => `<rect width="${W}" height="${H}" fill="${fill}"/>`;

// ---- the cards ----------------------------------------------------------

function noDice() {
  const pip = (x, y) => `<circle cx="${x}" cy="${y}" r="9.5" fill="${BLACK}"/>`;
  return svg(
    bg(BLACK) +
      mirrored(word("NO DICE", { top: 22, h: 40, w: 178 })) +
      // white die showing four, inside a red "no" sign
      `<rect x="80" y="130" width="90" height="90" rx="9" fill="${WHITE}"/>` +
      pip(101, 151) + pip(149, 151) + pip(101, 199) + pip(149, 199) +
      `<circle cx="125" cy="175" r="78" fill="none" stroke="${RED}" stroke-width="15"/>` +
      `<line x1="70" y1="120" x2="180" y2="230" stroke="${RED}" stroke-width="15"/>`,
    "No Dice"
  );
}

function mustBust() {
  const bar = (y) => `<rect x="34" y="${y}" width="182" height="30" fill="${BLACK}" stroke="${WHITE}" stroke-width="4"/>`;
  const big = { h: 96, w: 176, fill: WHITE, stroke: BLACK, sw: 9 };
  return svg(
    bg(RED) +
      `<rect x="12" y="12" width="226" height="326" rx="6" fill="none" stroke="${WHITE}" stroke-width="3"/>` +
      bar(30) +
      word("MUST", { top: 78, ...big }) +
      word("BUST!", { top: 184, ...big }) +
      bar(290),
    "Must Bust"
  );
}

function doubleTrouble() {
  const bar = (y) => `<rect x="30" y="${y}" width="190" height="36" fill="${RED}"/>`;
  const line = { h: 62, w: 186 };
  const hollow = { ...line, fill: WHITE, stroke: BLACK, sw: 7 };
  return svg(
    bg(BLACK) +
      `<rect x="13" y="13" width="224" height="324" rx="5" fill="${WHITE}"/>` +
      bar(28) +
      word("DOUBLE", { top: 78, ...hollow }) +
      word("TROUBLE", { top: 144, ...line, fill: BLACK }) +
      word("DOUBLE", { top: 210, ...hollow }) +
      bar(286),
    "Double Trouble"
  );
}

function fill1000() {
  return svg(
    bg(WHITE) +
      `<rect x="44" y="106" width="162" height="138" fill="${RED}"/>` +
      mirrored(
        word("FILL", { top: 22, h: 80, w: 128, fill: RED, stroke: WHITE, sw: 6 }) +
          word("1000", { top: 114, h: 54, w: 146, fill: WHITE, stroke: BLACK, sw: 7 })
      ),
    "Fill 1000"
  );
}

function bonus(amount) {
  return svg(
    bg(WHITE) +
      // red bands run behind the number; a thick white edge on the digits
      // cuts them away around each figure, like the printed card
      `<rect x="0" y="104" width="${W}" height="38" fill="${RED}"/>` +
      `<rect x="0" y="208" width="${W}" height="38" fill="${RED}"/>` +
      mirrored(
        word("BONUS", { top: 26, h: 44, w: 118, fill: BLACK }) +
          word(String(amount), { top: 80, h: 86, w: 148, fill: BLACK, stroke: WHITE, sw: 12 })
      ),
    `Bonus ${amount}`
  );
}

function vengeance() {
  // A devil's pitchfork, white on a red panel.
  const barb = (x, y) => `<path d="M${x} ${y - 30} L${x - 15} ${y + 3} L${x} ${y - 6} L${x + 15} ${y + 3} Z" fill="${WHITE}"/>`;
  const turn = `rotate(-16 125 280)`;
  const fork =
    `<g transform="${turn}" stroke="${WHITE}" stroke-width="13" stroke-linecap="round" fill="none">` +
    `<path d="M125 350 L125 274"/>` +
    `<path d="M80 222 Q80 274 125 274 Q170 274 170 222"/>` +
    `<path d="M125 274 L125 212"/>` +
    `</g>` +
    `<g transform="${turn}">${barb(80, 220)}${barb(125, 208)}${barb(170, 220)}</g>`;
  return svg(
    bg(BLACK) +
      word("VENGEANCE", { top: 20, h: 46, w: 212 }) +
      word("2500", { top: 76, h: 92, w: 196 }) +
      `<svg x="22" y="186" width="206" height="144" viewBox="22 186 206 144">` +
      `<rect x="22" y="186" width="206" height="144" fill="${RED}"/>${fork}</svg>`,
    "Vengeance 2500"
  );
}

// The back of every card: red, with a white band running corner to corner
// and "FILL OR BUST!" slanted across it, "DRAW CARD" up in two corners. The
// printed design is laid out on the card turned sideways, so it's drawn in
// landscape (350 x 250) and turned to stand upright in the portrait card.
function back() {
  const LW = H, LH = W; // landscape width/height
  const cx = LW / 2, cy = LH / 2;
  const drawCard = (tx, ty) =>
    `<g transform="translate(${tx} ${ty}) rotate(90)">` +
    word("DRAW", { top: 0, h: 19, w: 58, cx: 29 }) +
    word("CARD", { top: 23, h: 19, w: 58, cx: 29 }) +
    `</g>`;
  const band =
    `<g transform="rotate(19 ${cx} ${cy})">` +
    `<rect x="-80" y="${cy - 40}" width="${LW + 160}" height="76" fill="${WHITE}"/>` +
    `<g transform="translate(${cx} ${cy}) skewX(-12) translate(${-cx} ${-cy})">` +
    word("FILL OR BUST!", { top: cy - 29, h: 54, w: 300, cx, fill: RED }) +
    `</g></g>`;
  return svg(
    `<g transform="translate(0 ${H}) rotate(-90)">` +
      `<rect width="${LW}" height="${LH}" fill="${RED}"/>` +
      band +
      drawCard(LW - 12, 12) +
      drawCard(12 + 42, LH - 12 - 58) +
      `</g>` +
      // thin printed white rim
      `<rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="9" fill="none" stroke="${WHITE}" stroke-width="3" opacity="0.9"/>`,
    "Fill or Bust card back"
  );
}

// Title-screen logo: the card back's look blown up -- a red slab with the
// white band and the big slanted "FILL OR BUST!" across it.
export function titleLogoSVG(n = 0) {
  const LW = 600, LH = 236, cx = LW / 2, cy = LH / 2;
  return (
    `<svg class="logo-art" viewBox="0 0 ${LW} ${LH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Fill or Bust!">` +
    `<defs><clipPath id="logoClip${n}"><rect x="8" y="8" width="${LW - 16}" height="${LH - 16}" rx="16"/></clipPath></defs>` +
    `<rect x="8" y="8" width="${LW - 16}" height="${LH - 16}" rx="16" fill="${RED}"/>` +
    `<g clip-path="url(#logoClip${n})"><g transform="rotate(-7 ${cx} ${cy})">` +
    `<rect x="-40" y="${cy - 58}" width="${LW + 80}" height="112" fill="${WHITE}"/>` +
    `<g transform="translate(${cx} ${cy}) skewX(-12) translate(${-cx} ${-cy})">` +
    word("FILL OR BUST!", { top: cy - 42, h: 82, w: 500, cx, fill: RED }) +
    `</g></g></g>` +
    `<rect x="16" y="16" width="${LW - 32}" height="${LH - 32}" rx="11" fill="none" stroke="${WHITE}" stroke-width="4"/>` +
    `</svg>`
  );
}

export function cardBackSVG() {
  return cardFaceSVG({ id: "BACK" });
}

const ART = {
  BACK: back,
  NO_DICE: noDice,
  MUST_BUST: mustBust,
  DOUBLE_TROUBLE: doubleTrouble,
  FILL_1000: fill1000,
  BONUS_300: () => bonus(300),
  BONUS_400: () => bonus(400),
  BONUS_500: () => bonus(500),
  VENGEANCE: vengeance,
};

const cache = new Map();
export function cardFaceSVG(card) {
  if (!card || !ART[card.id]) return null;
  if (!cache.has(card.id)) cache.set(card.id, ART[card.id]());
  return cache.get(card.id);
}

// ---- the same faces painted onto a 2D canvas -----------------------------
// For textures (the card box on the 3D table). Walks the SVG above with a
// tiny renderer that covers exactly what these cards use, so the canvas uses
// the page's own loaded fonts and never gets "tainted" the way drawing an
// SVG <img> can on some browsers (which would block it as a WebGL texture).

const INHERIT = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "paint-order"];

function paintNode(x, el, style) {
  const st = { ...style };
  for (const a of INHERIT) if (el.hasAttribute(a)) st[a] = el.getAttribute(a);
  const n = (a, d = 0) => parseFloat(el.getAttribute(a) ?? d);
  const tag = el.tagName;

  const paint = (path) => {
    const fill = st.fill !== "none" ? st.fill : null;
    const stroke = st.stroke && st.stroke !== "none" ? st.stroke : null;
    x.lineWidth = parseFloat(st["stroke-width"] || 1);
    x.lineCap = st["stroke-linecap"] || "butt";
    x.lineJoin = st["stroke-linejoin"] || "miter";
    const doFill = () => fill && ((x.fillStyle = fill), path ? x.fill(path) : 0);
    const doStroke = () => stroke && ((x.strokeStyle = stroke), path ? x.stroke(path) : 0);
    if (st["paint-order"] === "stroke") { doStroke(); doFill(); } else { doFill(); doStroke(); }
  };

  x.save();
  // transform="translate(..) rotate(a [cx cy]) skewX(a) scale(..)", in order
  const tf = el.getAttribute("transform") || "";
  for (const [, fn, args] of tf.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const a = args.trim().split(/[\s,]+/).map(Number);
    if (fn === "translate") x.translate(a[0], a[1] || 0);
    else if (fn === "scale") x.scale(a[0], a[1] ?? a[0]);
    else if (fn === "skewX") x.transform(1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0);
    else if (fn === "rotate") {
      const [ang, rx = 0, ry = 0] = a;
      x.translate(rx, ry);
      x.rotate((ang * Math.PI) / 180);
      x.translate(-rx, -ry);
    }
  }

  if (tag === "rect") {
    const p = new Path2D();
    p.roundRect(n("x"), n("y"), n("width"), n("height"), n("rx"));
    paint(p);
  } else if (tag === "circle") {
    const p = new Path2D();
    p.arc(n("cx"), n("cy"), n("r"), 0, Math.PI * 2);
    paint(p);
  } else if (tag === "line") {
    const p = new Path2D();
    p.moveTo(n("x1"), n("y1"));
    p.lineTo(n("x2"), n("y2"));
    paint(p);
  } else if (tag === "path") {
    paint(new Path2D(el.getAttribute("d")));
  } else if (tag === "text") {
    const size = n("font-size");
    x.font = `${size}px ${el.getAttribute("font-family")}`;
    x.textAlign = "center";
    x.textBaseline = "alphabetic";
    const str = el.textContent;
    const want = n("textLength");
    const scale = want ? want / x.measureText(str).width : 1;
    x.translate(n("x"), n("y"));
    x.scale(scale, 1);
    x.lineWidth = parseFloat(st["stroke-width"] || 1) / scale; // keep the outline even
    x.lineJoin = "round";
    const fill = () => st.fill && st.fill !== "none" && ((x.fillStyle = st.fill), x.fillText(str, 0, 0));
    const stroke = () => st.stroke && ((x.strokeStyle = st.stroke), x.strokeText(str, 0, 0));
    if (st["paint-order"] === "stroke") { stroke(); fill(); } else { fill(); stroke(); }
  } else {
    if (tag === "svg" && el.hasAttribute("x")) {
      // nested <svg>: clips its contents to its box (same coordinates here)
      x.beginPath();
      x.rect(n("x"), n("y"), n("width"), n("height"));
      x.clip();
    }
    for (const child of el.children) paintNode(x, child, st);
  }
  x.restore();
}

const parsed = new Map();
// Paints card `id`'s face into the box (0,0)-(w,h) of a 2D canvas context.
export function paintCardFace(x, id, w, h) {
  const markup = cardFaceSVG({ id });
  if (!markup) return;
  if (!parsed.has(id)) parsed.set(id, new DOMParser().parseFromString(markup, "image/svg+xml").documentElement);
  x.save();
  x.scale(w / W, h / H);
  x.beginPath();
  x.rect(0, 0, W, H); // the card's own edge clips, as the <svg> does
  x.clip();
  paintNode(x, parsed.get(id), { fill: "#000" });
  x.restore();
}
