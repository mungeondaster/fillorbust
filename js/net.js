// The only module that talks to Firebase. Everything else (game.js, main.js)
// goes through this thin wrapper: room create/join, presence, and a small
// event stream that Game uses to stay in lockstep with other players.
//
// Design note: every client runs its own full Game/Dice3D/CardTable instance
// (see js/game.js). What travels over the network is only the unpredictable
// inputs -- dice roll outcomes, card draws, and human free-choice decisions
// (hold selection, bank-vs-continue, Vengeance accept/decline). Everything
// else (rules, CPU decisions, scoring) is a deterministic function of already-
// synced state, so it's computed identically and locally by every client
// without any network traffic.

import { firebaseConfig } from "./firebaseConfig.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
  set,
  update,
  get,
  remove,
  onValue,
  onChildAdded,
  onDisconnect,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I

function randomRoomCode() {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class NetSession {
  constructor() {
    // A placeholder config doesn't fail fast -- Firebase's SDK just retries
    // the (nonexistent) connection forever, which looks like a hang rather
    // than an error. Catch the obvious "forgot to configure it" case here so
    // it surfaces immediately instead.
    if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
      throw new Error("Firebase isn't configured yet -- paste your project config into js/firebaseConfig.js.");
    }
    this.app = initializeApp(firebaseConfig);
    this.db = getDatabase(this.app);
    this.roomCode = null;
    this.myPlayerId = null; // Firebase id (string) -- lobby/presence only, NOT the
    // same as Game's numeric player index. main.js maps between the two once
    // when building the finalized player list at game-start time.
    this.isHost = false;
    this.connId = randomId();

    // Event stream: an append-only list at /rooms/{code}/events, subscribed
    // once via onChildAdded. Events this client itself broadcast are
    // filtered out here (by connId) so they're never "replayed" back to the
    // sender -- the sender already applied its own action locally.
    // `next(type)` resolves with the next occurrence of that type, queuing
    // arrivals that show up before anyone's asked for them yet (important:
    // a fast client can otherwise broadcast and move on before a slower
    // client has reached the point of awaiting it).
    this._queues = new Map(); // type -> payload[]
    this._waiters = new Map(); // type -> resolve[]
  }

  async createRoom(hostName) {
    const code = randomRoomCode();
    const playerId = randomId();
    this.roomCode = code;
    this.myPlayerId = playerId;
    this.isHost = true;

    await set(ref(this.db, `rooms/${code}`), {
      meta: { createdAt: serverTimestamp(), started: false, hostPlayerId: playerId },
      players: {
        [playerId]: { name: hostName, type: "human", order: 0, connId: this.connId },
      },
    });
    this._setupPresence(playerId);
    return { code, playerId };
  }

  async joinRoom(code, name) {
    code = code.toUpperCase().trim();
    const roomRef = ref(this.db, `rooms/${code}`);
    const snap = await get(roomRef);
    if (!snap.exists()) throw new Error("Room not found. Check the code and try again.");
    const room = snap.val();
    if (room.meta?.started) throw new Error("That game has already started.");

    const playerId = randomId();
    const existingCount = room.players ? Object.keys(room.players).length : 0;
    if (existingCount >= 6) throw new Error("That room is full.");

    this.roomCode = code;
    this.myPlayerId = playerId;
    this.isHost = false;

    await set(ref(this.db, `rooms/${code}/players/${playerId}`), {
      name,
      type: "human",
      order: existingCount,
      connId: this.connId,
    });
    this._setupPresence(playerId);
    return { code, playerId };
  }

  // Only clears the live connection marker on disconnect, not the whole
  // player record -- a family member who briefly drops (phone screen lock,
  // wifi hiccup) doesn't get wiped from the lobby list.
  _setupPresence(playerId) {
    const connMarker = ref(this.db, `rooms/${this.roomCode}/players/${playerId}/connId`);
    onDisconnect(connMarker).remove();
  }

  subscribePlayers(callback) {
    onValue(ref(this.db, `rooms/${this.roomCode}/players`), (snap) => {
      const val = snap.val() || {};
      const list = Object.entries(val)
        .map(([id, p]) => ({ id, ...p }))
        .sort((a, b) => a.order - b.order);
      callback(list);
    });
  }

  async addCpuPlayer(name, difficulty) {
    const snap = await get(ref(this.db, `rooms/${this.roomCode}/players`));
    const order = snap.exists() ? Object.keys(snap.val()).length : 0;
    const playerId = randomId();
    await set(ref(this.db, `rooms/${this.roomCode}/players/${playerId}`), {
      name,
      type: "cpu",
      difficulty,
      order,
    });
  }

  async removePlayer(playerId) {
    await remove(ref(this.db, `rooms/${this.roomCode}/players/${playerId}`));
  }

  // Host only: locks the room and tells everyone (including itself, via the
  // same event stream every client reads) to build their local Game.
  async startGame(players, targetScore) {
    await update(ref(this.db, `rooms/${this.roomCode}/meta`), { started: true });
    await this.broadcast("gameStarted", { players, targetScore });
  }

  // ---- event stream ----

  async broadcast(type, payload) {
    await push(ref(this.db, `rooms/${this.roomCode}/events`), {
      type,
      payload,
      connId: this.connId,
      ts: serverTimestamp(),
    });
  }

  // Resolves with the next payload of this type from another client. Safe to
  // call before or after the event actually arrives.
  next(type) {
    const queue = this._queues.get(type);
    if (queue && queue.length) return Promise.resolve(queue.shift());
    return new Promise((resolve) => {
      if (!this._waiters.has(type)) this._waiters.set(type, []);
      this._waiters.get(type).push(resolve);
    });
  }

  startListening() {
    onChildAdded(ref(this.db, `rooms/${this.roomCode}/events`), (snap) => {
      const entry = snap.val();
      if (!entry || entry.connId === this.connId) return; // never replay my own actions
      const waiters = this._waiters.get(entry.type);
      if (waiters && waiters.length) {
        waiters.shift()(entry.payload);
        return;
      }
      if (!this._queues.has(entry.type)) this._queues.set(entry.type, []);
      this._queues.get(entry.type).push(entry.payload);
    });
  }

  leaveRoom() {
    if (!this.roomCode || !this.myPlayerId) return;
    remove(ref(this.db, `rooms/${this.roomCode}/players/${this.myPlayerId}/connId`));
  }
}

// Inert stand-in for single-device play, so Game never has to branch on
// "am I online" -- it always has a `net`, real or this no-op. next() resolves
// only for gameStarted-style flows that are explicitly kicked off elsewhere;
// for everything else it simply never resolves, which is harmless (offline
// play never reaches those await points -- see the isHost/CPU authority
// shortcut in Game).
export class NullNet {
  constructor() {
    this.isHost = true;
    this.myPlayerId = null;
  }
  async broadcast() {}
  next() {
    return new Promise(() => {});
  }
  startListening() {}
}
