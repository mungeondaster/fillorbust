// Short music stingers played when certain cards are revealed. game.js calls
// this on every client, so all players hear them. Cards not listed are silent
// (apart from the normal card flip sounds).
import { sfx } from "./sound.js?v=55";

const STINGERS = {
  NO_DICE: { group: "stingerNoDice", vol: 0.8 },
  MUST_BUST: { group: "stingerMustBust", vol: 0.75 },
  VENGEANCE: { group: "stingerVengeance", vol: 0.75 },
};

export const STINGER_IDS = Object.keys(STINGERS);

export function playCardStinger(cardId) {
  const s = STINGERS[cardId];
  if (s) sfx(s.group, { vol: s.vol, rate: 1 });
}
