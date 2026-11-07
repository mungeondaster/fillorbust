// The only module that talks to Firebase. Everything else (game.js, main.js)
// goes through this thin wrapper: room create/join/rejoin, presence, and the
// move log Game replays.
//
// Design: every client runs its own full Game (see js/game.js) as a pure
// function of (a) the game's start settings -- players, target score and a
// random seed, written once to /rooms/{code}/meta/game -- and (b) an ordered
// log of human decisions at /rooms/{code}/events/e000000, e000001, ...
//
// The seed makes the card deck and every CPU dice roll identical on every
// device, so no client is "in charge" of anything: the host can leave and the
// game carries on. Each log slot can only ever be written once (a Firebase
// transaction that refuses to overwrite), so even when two devices try to
// write at the same moment, everyone ends up reading the same sequence.
//
// That also makes rejoining simple: a refreshed or reconnected device just
// reads the log from the start, fast-forwarding (no animation or sound) until
// it reaches the present.

import { firebaseConfig } from "./firebaseConfig.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  get,
  remove,
  onValue,
  onChildAdded,
  onDisconnect,
  serverTimestamp,
  runTransaction,
  query,
  orderByKey,
  startAfter,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

import { EventLog, saveSession, clearSavedSession } from "./movelog.js?v=45";

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

const slotKey = (i) => "e" + String(i).padStart(6, "0");

export class NetSession extends EventLog {
  constructor() {
    super();
    // A placeholder config doesn't fail fast -- Firebase's SDK just retries
    // the (nonexistent) connection forever, which looks like a hang rather
    // than an error. Catch the obvious "forgot to configure it" case here so
    // it surfaces immediately instead.
    if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
      throw new Error("Firebase isn't configured yet -- paste your project config into js/firebaseConfig.js.");
    }
    this.app = initializeApp(firebaseConfig);
    this.db = getDatabase(this.app);
    this.online = true;
    this.roomCode = null;
    this.myPlayerId = null; // Firebase id (string) -- NOT Game's numeric seat index.
    this.isHost = false; // only matters in the lobby now
    this.connId = randomId();
    this.connected = false;
    this._connCbs = [];
    this._logOpened = null;
  }

  // ---- rooms ----

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
    this._setupPresence();
    return { code, playerId, game: null };
  }

  async joinRoom(code, name) {
    code = code.toUpperCase().trim();
    const snap = await get(ref(this.db, `rooms/${code}`));
    if (!snap.exists()) throw new Error("Room not found. Check the code and try again.");
    const room = snap.val();

    if (room.meta?.started) {
      // Joining a game in progress under the same name you played with puts
      // you back in your seat (new phone, cleared browser, etc.).
      const wanted = name.trim().toLowerCase();
      const match = Object.entries(room.players || {}).find(
        ([, p]) => p.type === "human" && p.name.trim().toLowerCase() === wanted
      );
      if (!match) {
        throw new Error("That game has already started. To get back in, enter the same name you played with.");
      }
      if (match[1].connId) throw new Error(`${match[1].name} is already connected to that game.`);
      return this.rejoinRoom(code, match[0]);
    }

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
    this._setupPresence();
    return { code, playerId, game: null };
  }

  // Back into a room this browser was already in (see getSavedSession), or
  // into a seat claimed by name from joinRoom.
  async rejoinRoom(code, playerId) {
    const snap = await get(ref(this.db, `rooms/${code}`));
    if (!snap.exists()) throw new Error("That game no longer exists.");
    const room = snap.val();
    if (!room.players?.[playerId]) throw new Error("You're no longer in that game.");
    if (room.meta?.started && !room.meta.game) {
      throw new Error("That game was started on an older version and can't be rejoined.");
    }
    this.roomCode = code;
    this.myPlayerId = playerId;
    this.isHost = room.meta?.hostPlayerId === playerId;
    this._setupPresence();
    return { code, playerId, game: room.meta?.game ?? null };
  }

  // Marks this player connected whenever Firebase is connected -- including
  // after a dropout -- and arranges for the server to clear the marker the
  // moment the connection is lost. The player record itself stays, so a
  // brief dropout (phone screen lock, wifi hiccup) never costs anyone a seat.
  _setupPresence() {
    saveSession(this.roomCode, this.myPlayerId);
    const connMarker = ref(this.db, `rooms/${this.roomCode}/players/${this.myPlayerId}/connId`);
    onValue(ref(this.db, ".info/connected"), (snap) => {
      this.connected = snap.val() === true;
      this._connCbs.forEach((cb) => cb(this.connected));
      if (this.connected && !this._left) {
        onDisconnect(connMarker)
          .remove()
          .then(() => set(connMarker, this.connId))
          .catch((err) => console.warn("presence", err));
      }
    });
  }

  onConnectionChange(cb) {
    this._connCbs.push(cb);
    cb(this.connected);
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

  // Host only (lobby): fixes the seating, target and shared seed. Every
  // client -- the host included -- builds its Game from onGameStarted.
  async startGame(players, targetScore) {
    const seed = Math.floor(Math.random() * 2 ** 31);
    await update(ref(this.db, `rooms/${this.roomCode}/meta`), {
      started: true,
      game: { players, targetScore, seed },
    });
  }

  onGameStarted(callback) {
    let fired = false;
    onValue(ref(this.db, `rooms/${this.roomCode}/meta/game`), (snap) => {
      const game = snap.val();
      if (game && !fired) {
        fired = true;
        callback(game);
      }
    });
  }

  // ---- move log ----

  // Loads every move made so far, then keeps listening for new ones.
  openLog() {
    if (this._logOpened) return this._logOpened;
    this._logOpened = (async () => {
      const eventsRef = ref(this.db, `rooms/${this.roomCode}/events`);
      const snap = await get(eventsRef);
      let lastKey = null;
      snap.forEach((child) => {
        this._putKey(child.key, child.val());
        lastKey = child.key;
      });
      const live = lastKey ? query(eventsRef, orderByKey(), startAfter(lastKey)) : eventsRef;
      onChildAdded(live, (child) => this._putKey(child.key, child.val()));
    })();
    return this._logOpened;
  }

  _putKey(key, val) {
    const i = parseInt(key.slice(1), 10);
    if (key[0] === "e" && Number.isFinite(i)) this._put(i, val);
  }

  // Claims log slot i for `entry`. Resolves true if it's ours, false if
  // someone else got there first (their entry is then what slot i holds).
  // applyLocally:false means nothing is shown until the server agrees, so a
  // lost race never flickers in and back out.
  async submit(i, entry) {
    try {
      const res = await runTransaction(
        ref(this.db, `rooms/${this.roomCode}/events/${slotKey(i)}`),
        (current) => (current === null ? entry : undefined),
        { applyLocally: false }
      );
      this._put(i, res.snapshot.val());
      return res.committed;
    } catch (err) {
      console.warn("submit failed", err);
      return false;
    }
  }

  // Adds an entry at the end of the log, wherever that is by now.
  async append(entry) {
    for (let tries = 0; tries < 50; tries++) {
      const i = this.logLength;
      if (await this.submit(i, entry)) return true;
      if (this.logLength <= i) return false; // an error, not a lost race
    }
    return false;
  }

  leaveRoom() {
    clearSavedSession();
    this._left = true;
    if (!this.roomCode || !this.myPlayerId) return;
    remove(ref(this.db, `rooms/${this.roomCode}/players/${this.myPlayerId}/connId`));
  }
}
