// The move log Game replays (see game.js / net.js), plus the saved "which
// online room am I in" session. No Firebase here, so single-device play
// never needs to download it (and works offline).

const SESSION_KEY = "fob.session";
const SESSION_MAX_AGE = 12 * 60 * 60 * 1000; // offer to rejoin for 12 hours

export function saveSession(code, playerId) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ code, playerId, ts: Date.now() }));
  } catch {}
}

export function getSavedSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (s && s.code && s.playerId && Date.now() - (s.ts || 0) < SESSION_MAX_AGE) return s;
  } catch {}
  return null;
}

export function clearSavedSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

// An append-only, gap-free list of entries with "wait for entry i".
export class EventLog {
  constructor() {
    this.log = [];
    this._early = new Map(); // index -> entry that arrived before an earlier one
    this._waiters = new Map(); // index -> resolve[]
  }

  get logLength() {
    return this.log.length;
  }

  waitFor(i) {
    if (i < this.log.length) return Promise.resolve(this.log[i]);
    return new Promise((resolve) => {
      if (!this._waiters.has(i)) this._waiters.set(i, []);
      this._waiters.get(i).push(resolve);
    });
  }

  _put(i, entry) {
    if (i < this.log.length || entry == null) return;
    this._early.set(i, entry);
    while (this._early.has(this.log.length)) {
      const n = this.log.length;
      this.log.push(this._early.get(n));
      this._early.delete(n);
      const waiters = this._waiters.get(n);
      if (waiters) {
        this._waiters.delete(n);
        waiters.forEach((resolve) => resolve(this.log[n]));
      }
    }
  }
}

// Single-device play: the same move log, just kept in memory -- so Game has
// exactly one code path whether it's online or not.
export class LocalNet extends EventLog {
  constructor() {
    super();
    this.online = false;
    this.connId = "local";
  }
  async openLog() {}
  async submit(i, entry) {
    if (i !== this.log.length) return false;
    this._put(i, entry);
    return true;
  }
  async append(entry) {
    return this.submit(this.log.length, entry);
  }
  leaveRoom() {}
}
