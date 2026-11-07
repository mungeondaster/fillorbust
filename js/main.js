import { Game } from "./game.js?v=45";
import { Dice3D } from "./dice3d.js?v=45";
import { getSceneId } from "./scenes/index.js?v=45";
import { unlockAudio, preloadSounds, sfx } from "./sound.js?v=45";
import { attachSoundButton } from "./soundPanel.js?v=45";
import { titleLogoSVG, cardFaceSVG } from "./cardArt.js?v=45";
import { startFallingCards } from "./fallingCards.js?v=45";
import { getSavedSession, clearSavedSession } from "./movelog.js?v=45";

// Start downloading the table sounds while players are still on the menu.
preloadSounds();
// Title logo, with a fan of real card faces peeking out behind it.
document.getElementById("logoArt").innerHTML = titleLogoSVG();
document.getElementById("logoFan").innerHTML = ["NO_DICE", "FILL_1000", "VENGEANCE", "DOUBLE_TROUBLE", "MUST_BUST"]
  .map((id, i) => `<span class="fan-card" style="--i:${i - 2}">${cardFaceSVG({ id })}</span>`)
  .join("");
startFallingCards(document.getElementById("setupScreen"));
// Speaker buttons (title screen + in-game) open the music/effects volume panel.
attachSoundButton(document.getElementById("menuSoundBtn"));
attachSoundButton(document.getElementById("muteBtn"));
import { MULTIPLAYER_ENABLED } from "./firebaseConfig.js";

const setupScreen = document.getElementById("setupScreen");
const gameScreen = document.getElementById("gameScreen");
const lobbyScreen = document.getElementById("lobbyScreen");
const playerRowsEl = document.getElementById("playerRows");
const addPlayerBtn = document.getElementById("addPlayerBtn");
const startGameBtn = document.getElementById("startGameBtn");
const targetScoreSel = document.getElementById("targetScoreSel");

let playerRows = [];

function addPlayerRow(defaultName, defaultType) {
  const row = document.createElement("div");
  row.className = "player-row";
  row.innerHTML = `
    <input type="text" class="p-name" value="${defaultName}" maxlength="14" />
    <select class="p-type">
      <option value="human" ${defaultType === "human" ? "selected" : ""}>Human</option>
      <option value="cpu" ${defaultType === "cpu" ? "selected" : ""}>CPU</option>
    </select>
    <select class="p-diff">
      <option value="easy">Easy</option>
      <option value="normal" selected>Normal</option>
      <option value="hard">Hard</option>
    </select>
    <button class="remove-row" title="Remove player">✕</button>
  `;
  const typeSel = row.querySelector(".p-type");
  const diffSel = row.querySelector(".p-diff");
  const syncDiff = () => (diffSel.style.display = typeSel.value === "cpu" ? "" : "none");
  typeSel.addEventListener("change", syncDiff);
  syncDiff();
  row.querySelector(".remove-row").addEventListener("click", () => {
    if (playerRows.length <= 2) return;
    row.remove();
    playerRows = playerRows.filter((r) => r !== row);
  });
  playerRowsEl.appendChild(row);
  playerRows.push(row);
}

addPlayerRow("Player 1", "human");
addPlayerRow("CPU 1", "cpu");

addPlayerBtn.addEventListener("click", () => {
  if (playerRows.length >= 6) return;
  addPlayerRow(`Player ${playerRows.length + 1}`, "cpu");
});

startGameBtn.addEventListener("click", () => {
  const players = playerRows.map((row) => ({
    name: row.querySelector(".p-name").value.trim() || "Player",
    type: row.querySelector(".p-type").value,
    difficulty: row.querySelector(".p-diff").value,
  }));
  const targetScore = Number(targetScoreSel.value);
  setupScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  launchGame(players, targetScore);
});

// ---------------- Online mode (setup tabs + lobby) ----------------
// Only shown once js/firebaseConfig.js has a real project config -- see
// that file for setup instructions. Everything below is inert until then.

if (MULTIPLAYER_ENABLED) {
  setupOnlineMode();
}

function setupOnlineMode() {
  const modeTabs = document.getElementById("modeTabs");
  const localModeBtn = document.getElementById("localModeBtn");
  const onlineModeBtn = document.getElementById("onlineModeBtn");
  const localSetupPanel = document.getElementById("localSetupPanel");
  const onlineSetupPanel = document.getElementById("onlineSetupPanel");
  const onlineChoicePane = document.getElementById("onlineChoicePane");
  const createRoomPane = document.getElementById("createRoomPane");
  const joinRoomPane = document.getElementById("joinRoomPane");
  const createRoomChoiceBtn = document.getElementById("createRoomChoiceBtn");
  const joinRoomChoiceBtn = document.getElementById("joinRoomChoiceBtn");
  const createNameInput = document.getElementById("createNameInput");
  const createRoomBtn = document.getElementById("createRoomBtn");
  const joinCodeInput = document.getElementById("joinCodeInput");
  const joinNameInput = document.getElementById("joinNameInput");
  const joinRoomBtn = document.getElementById("joinRoomBtn");

  modeTabs.classList.remove("hidden");

  const showPane = (pane) => {
    for (const el of [onlineChoicePane, createRoomPane, joinRoomPane]) {
      el.classList.toggle("hidden", el !== pane);
    }
  };

  localModeBtn.addEventListener("click", () => {
    localModeBtn.classList.add("active");
    onlineModeBtn.classList.remove("active");
    localSetupPanel.classList.remove("hidden");
    onlineSetupPanel.classList.add("hidden");
  });
  onlineModeBtn.addEventListener("click", () => {
    onlineModeBtn.classList.add("active");
    localModeBtn.classList.remove("active");
    onlineSetupPanel.classList.remove("hidden");
    localSetupPanel.classList.add("hidden");
    showPane(onlineChoicePane);
  });

  // Refreshed, closed the tab, or the phone dropped the page? Offer to put
  // this browser straight back into the online game it was in.
  const saved = getSavedSession();
  const rejoinBox = document.getElementById("rejoinBox");
  if (saved) {
    document.getElementById("rejoinCode").textContent = saved.code;
    rejoinBox.classList.remove("hidden");
    const rejoinBtn = document.getElementById("rejoinBtn");
    rejoinBtn.addEventListener("click", async () => {
      clearFormError(rejoinBox);
      rejoinBtn.disabled = true;
      try {
        const { NetSession } = await import("./net.js?v=45");
        const net = new NetSession();
        const { game } = await net.rejoinRoom(saved.code, saved.playerId);
        enterRoom(net, game);
      } catch (err) {
        clearSavedSession();
        showFormError(rejoinBox, err.message || "Couldn't rejoin that game.");
        rejoinBtn.classList.add("hidden");
      } finally {
        rejoinBtn.disabled = false;
      }
    });
    document.getElementById("rejoinDismissBtn").addEventListener("click", () => {
      clearSavedSession();
      rejoinBox.classList.add("hidden");
    });
  }

  createRoomChoiceBtn.addEventListener("click", () => showPane(createRoomPane));
  joinRoomChoiceBtn.addEventListener("click", () => showPane(joinRoomPane));
  document.querySelectorAll(".online-back-btn").forEach((btn) => {
    btn.addEventListener("click", () => showPane(onlineChoicePane));
  });

  const showFormError = (pane, message) => {
    const el = pane.querySelector(".form-error");
    el.textContent = message;
    el.classList.remove("hidden");
  };
  const clearFormError = (pane) => pane.querySelector(".form-error").classList.add("hidden");

  createRoomBtn.addEventListener("click", async () => {
    clearFormError(createRoomPane);
    const name = createNameInput.value.trim() || "Host";
    createRoomBtn.disabled = true;
    try {
      const { NetSession } = await import("./net.js?v=45");
      const net = new NetSession();
      await net.createRoom(name);
      enterRoom(net, null);
    } catch (err) {
      showFormError(createRoomPane, err.message || "Couldn't create room. Check your Firebase setup.");
    } finally {
      createRoomBtn.disabled = false;
    }
  });

  joinRoomBtn.addEventListener("click", async () => {
    clearFormError(joinRoomPane);
    const code = joinCodeInput.value.trim();
    const name = joinNameInput.value.trim() || "Player";
    if (!code) {
      showFormError(joinRoomPane, "Enter the room code your host gave you.");
      return;
    }
    joinRoomBtn.disabled = true;
    try {
      const { NetSession } = await import("./net.js?v=45");
      const net = new NetSession();
      // Joining a game already under way with your old name puts you back
      // in your seat.
      const { game } = await net.joinRoom(code, name);
      enterRoom(net, game);
    } catch (err) {
      showFormError(joinRoomPane, err.message || "Couldn't join that room.");
    } finally {
      joinRoomBtn.disabled = false;
    }
  });
}

// After creating/joining/rejoining a room: straight into the game if it's
// already under way, otherwise the lobby until the host starts it.
function enterRoom(net, game) {
  window.__net = net; // debug handle
  setupScreen.classList.add("hidden");
  if (game) startOnlineGame(net, game);
  else enterLobby(net);
}

function startOnlineGame(net, { players, targetScore, seed }) {
  const myPlayerId = players.findIndex((p) => p.fbId === net.myPlayerId);
  lobbyScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  launchGame(players, targetScore, { net, myPlayerId: myPlayerId < 0 ? null : myPlayerId, seed });
}

function enterLobby(net) {
  const lobbyRoomCode = document.getElementById("lobbyRoomCode");
  const lobbyPlayers = document.getElementById("lobbyPlayers");
  const lobbyHostControls = document.getElementById("lobbyHostControls");
  const lobbyTargetScoreSel = document.getElementById("lobbyTargetScoreSel");
  const lobbyAddCpuBtn = document.getElementById("lobbyAddCpuBtn");
  const lobbyStartBtn = document.getElementById("lobbyStartBtn");
  const lobbyWaitingMsg = document.getElementById("lobbyWaitingMsg");
  const lobbyLeaveBtn = document.getElementById("lobbyLeaveBtn");

  lobbyScreen.classList.remove("hidden");
  lobbyRoomCode.textContent = net.roomCode;
  lobbyHostControls.classList.toggle("hidden", !net.isHost);
  lobbyWaitingMsg.classList.toggle("hidden", net.isHost);

  let latestPlayers = [];
  net.subscribePlayers((players) => {
    latestPlayers = players;
    lobbyPlayers.innerHTML = "";
    players.forEach((p) => {
      const el = document.createElement("div");
      el.className = "lobby-player" + (p.order === 0 ? " is-host" : "");
      const tag = p.type === "cpu" ? `CPU (${p.difficulty})` : p.connId ? "Connected" : "Disconnected";
      el.innerHTML = `<span class="lp-name">${p.name}</span><span class="lp-tag">${tag}</span>`;
      lobbyPlayers.appendChild(el);
    });
    if (net.isHost) lobbyStartBtn.disabled = players.length < 2;
  });

  if (net.isHost) {
    lobbyAddCpuBtn.addEventListener("click", () => {
      const cpuCount = latestPlayers.filter((p) => p.type === "cpu").length;
      net.addCpuPlayer(`CPU ${cpuCount + 1}`, "normal");
    });

    lobbyStartBtn.addEventListener("click", async () => {
      const targetScore = Number(lobbyTargetScoreSel.value);
      // Keep each player's Firebase id alongside the shape Game already
      // expects, so every client can work out which array index is "them"
      // once this same list comes back through the gameStarted event.
      // Firebase rejects writes containing `undefined` -- human players
      // never have a `difficulty`, so that field is only included for CPUs.
      const players = latestPlayers.map((p) => {
        const player = { fbId: p.id, name: p.name, type: p.type };
        if (p.type === "cpu") player.difficulty = p.difficulty;
        return player;
      });
      const lobbyError = document.getElementById("lobbyError");
      lobbyError.classList.add("hidden");
      lobbyStartBtn.disabled = true;
      try {
        await net.startGame(players, targetScore);
      } catch (err) {
        lobbyStartBtn.disabled = false;
        lobbyError.textContent = "Couldn't start the game: " + (err.message || err);
        lobbyError.classList.remove("hidden");
      }
    });
  }

  lobbyLeaveBtn.addEventListener("click", () => {
    net.leaveRoom();
    window.location.reload();
  });

  net.onGameStarted((game) => startOnlineGame(net, game));
}

function launchGame(players, targetScore, netInfo) {
  const diceContainer = document.getElementById("diceCanvas");
  const cardContainer = document.getElementById("cardTable");
  const statusEl = document.getElementById("statusText");
  const mainMenuBtn = document.getElementById("mainMenuBtn");
  const turnScoreEl = document.getElementById("turnScoreVal");
  const heldRowEl = document.getElementById("heldRow");
  const playersEl = document.getElementById("playerList");
  const rollBtn = document.getElementById("rollBtn");
  const bankBtn = document.getElementById("bankBtn");
  const confirmBtn = document.getElementById("confirmHoldBtn");
  const fillPrompt = document.getElementById("fillPrompt");
  const continueFillBtn = document.getElementById("continueFillBtn");
  const bankFillBtn = document.getElementById("bankFillBtn");
  const pendingScoreEl = document.getElementById("pendingScore");
  const gameOverModal = document.getElementById("gameOverModal");
  const gameOverText = document.getElementById("gameOverText");
  const playAgainBtn = document.getElementById("playAgainBtn");
  const vengeanceModal = document.getElementById("vengeanceModal");
  const vengeanceText = document.getElementById("vengeanceText");
  const vengeancePlayBtn = document.getElementById("vengeancePlayBtn");
  const vengeanceDeclineBtn = document.getElementById("vengeanceDeclineBtn");
  const bustStamp = document.getElementById("bustStamp");
  const noDiceStamp = document.getElementById("noDiceStamp");

  const dieSlots = Array.from(document.querySelectorAll(".die-slot"));

  // `game` is assigned once Game finishes constructing, below -- but ui
  // methods can be invoked *during* construction (Game's constructor kicks
  // off the first turn), so this is declared here (not const) and isMyTurn()
  // treats "not assigned yet" as "yes" (matches single-device behavior,
  // and that split-second window is over before a real player ever acts).
  let game;
  const isMyTurn = () => !game || game.isLocalSeat(game.currentPlayer);
  const online = !!netInfo?.net;
  let connectedSeats = null; // online: seat index -> connected right now?
  let cancelVengeancePrompt = null;

  const ui = {
    setStatus(text) {
      statusEl.textContent = text;
    },
    setTurnScore(n) {
      const text = fmt(n);
      if (turnScoreEl.textContent === text) return;
      turnScoreEl.textContent = text;
      if (n > 0) {
        turnScoreEl.classList.remove("bump");
        void turnScoreEl.offsetWidth;
        turnScoreEl.classList.add("bump");
      }
    },
    setHeld(values) {
      heldRowEl.textContent = values.length ? `Held ${values.join(" · ")}` : "";
    },
    setRollEnabled(v) {
      rollBtn.disabled = !(v && isMyTurn());
    },
    setBankEnabled(v) {
      bankBtn.disabled = !(v && isMyTurn());
    },
    setFillPromptEnabled(v) {
      fillPrompt.classList.toggle("hidden", !(v && isMyTurn()));
    },
    renderPlayers(players, currentIndex) {
      playersEl.innerHTML = "";
      players.forEach((p, i) => {
        const el = document.createElement("div");
        el.className = "player-card" + (i === currentIndex ? " active" : "");
        const pct = Math.max(0, Math.min(100, (p.score / targetScore) * 100));
        el.innerHTML =
          `<span class="p-name"></span><span class="p-score">${fmt(p.score)}</span>` +
          `<span class="p-bar"><span style="width:${pct}%"></span></span>`;
        const nameEl = el.querySelector(".p-name");
        nameEl.textContent = p.name + (p.type === "cpu" ? " 🤖" : "");
        let tag = null;
        if (p.cpuControlled) tag = ["CPU playing", ""];
        else if (online && p.type !== "cpu" && connectedSeats && !connectedSeats[i]) tag = ["offline", "off"];
        if (tag) {
          const t = document.createElement("span");
          t.className = "p-tag " + tag[1];
          t.textContent = tag[0];
          nameEl.appendChild(t);
        }
        playersEl.appendChild(el);
      });
      playersEl.querySelector(".active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    syncDiceState(dice) {
      dice.forEach((d, i) => {
        const slot = dieSlots[i];
        slot.classList.toggle("held", d.state === "tray");
        slot.classList.remove("selected");
      });
      game?.dice3d.setSelected([]);
    },
    setDiceFaces(indices, values) {
      indices.forEach((idx, k) => {
        setPips(dieSlots[idx], values[k]);
        dieSlots[idx].classList.remove("inactive");
      });
    },
    // Blanks out the 2D dice readout at the start of a turn -- no leftover
    // pips from whatever the previous player last rolled.
    resetDiceFaces() {
      dieSlots.forEach((slot) => {
        slot.innerHTML = '<div class="pip-grid"></div>';
        slot.classList.add("inactive");
        slot.classList.remove("selected", "clickable", "held");
      });
    },
    enableDiceSelection(indices) {
      const mine = isMyTurn();
      dieSlots.forEach((slot, i) => {
        slot.classList.toggle("clickable", mine && indices.includes(i));
      });
      confirmBtn.disabled = true;
    },
    clearDiceSelectionUI() {
      dieSlots.forEach((slot) => {
        slot.classList.remove("selected", "clickable");
      });
      confirmBtn.disabled = true;
      pendingScoreEl.innerHTML = "&nbsp;";
      game?.dice3d.setSelected([]);
    },
    setSelectedDice(indices) {
      dieSlots.forEach((slot, i) => {
        slot.classList.toggle("selected", indices.includes(i));
      });
      game?.dice3d.setSelected(indices);
      if (isMyTurn()) sfx("chipLay", { vol: 0.35 });
    },
    setPendingScore(result) {
      if (!result.valid || result.score === 0) {
        pendingScoreEl.textContent = "Pick scoring dice";
        pendingScoreEl.classList.remove("valid");
        confirmBtn.disabled = true;
      } else {
        pendingScoreEl.textContent = `Hold for +${fmt(result.score)}`;
        pendingScoreEl.classList.add("valid");
        confirmBtn.disabled = false;
      }
    },
    showGameOver(winner, players) {
      const sorted = [...players].sort((a, b) => b.score - a.score);
      gameOverText.innerHTML =
        `<h2>${winner.name} wins!</h2>` +
        sorted.map((p, i) => `<div>${i + 1}. ${p.name} — ${p.score}</div>`).join("");
      gameOverModal.classList.remove("hidden");
      if (online) clearSavedSession(); // nothing left to rejoin
    },
    // Closes the Vengeance question if the decision got made elsewhere.
    cancelVengeance() {
      cancelVengeancePrompt?.();
    },
    promptVengeance(leaders) {
      const names = leaders.map((p) => p.name).join(" & ");
      const themPlural = leaders.length > 1 ? "each lose" : "loses";
      vengeanceText.textContent =
        `Play Vengeance against ${names}? You must score a FILL this turn or you'll lose all ` +
        `your turn's points. If you FILL, your turn's points bank immediately and ${names} ${themPlural} 2500 points.`;
      vengeanceModal.classList.remove("hidden");
      return new Promise((resolve) => {
        const cleanup = () => {
          cancelVengeancePrompt = null;
          vengeanceModal.classList.add("hidden");
          vengeancePlayBtn.removeEventListener("click", onPlay);
          vengeanceDeclineBtn.removeEventListener("click", onDecline);
        };
        cancelVengeancePrompt = () => {
          cleanup();
          resolve(null);
        };
        const onPlay = () => {
          cleanup();
          resolve(true);
        };
        const onDecline = () => {
          cleanup();
          resolve(false);
        };
        vengeancePlayBtn.addEventListener("click", onPlay);
        vengeanceDeclineBtn.addEventListener("click", onDecline);
      });
    },
    // Rubber-stamps "BUST" across the table: slams in, holds for a beat,
    // then fades away. Resolves once it's fully gone so callers can wait
    // before moving on to the next player.
    showBustStamp() {
      return playStampAnimation(bustStamp);
    },
    // Same slam-in/hold/fade treatment, but for a "No Dice" card: a big die
    // with a red no-entry circle slashed across it.
    showNoDiceStamp() {
      return playStampAnimation(noDiceStamp);
    },
  };

  // Shared slam-in / hold-3s / fade-out lifecycle used by both the BUST and
  // No Dice stamps. Resolves once the element is fully hidden again.
  function playStampAnimation(el) {
    return new Promise((resolve) => {
      el.classList.remove("hidden", "stamp-out");
      // force reflow so the animation restarts cleanly if triggered twice in a row
      void el.offsetWidth;
      el.classList.add("stamp-in");
      setTimeout(() => {
        el.classList.remove("stamp-in");
        el.classList.add("stamp-out");
        setTimeout(() => {
          el.classList.add("hidden");
          el.classList.remove("stamp-out");
          resolve();
        }, 550);
      }, 3000);
    });
  }

  function fmt(n) {
    return Number(n).toLocaleString("en-US");
  }

  function setPips(slot, value) {
    const layouts = {
      1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
    };
    slot.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "pip-grid";
    for (let i = 0; i < 9; i++) {
      const dot = document.createElement("span");
      dot.className = "pip" + (layouts[value].includes(i) ? " on" : "");
      grid.appendChild(dot);
    }
    slot.appendChild(grid);
  }

  game = new Game({
    diceContainer,
    cardContainer,
    players,
    targetScore,
    ui,
    net: netInfo?.net,
    myPlayerId: netInfo?.myPlayerId,
    seed: netInfo?.seed,
  });

  if (online) watchConnections(game, netInfo.net, players, () => ui.renderPlayers(game.players, game.gameOver ? -1 : game.currentPlayerIndex), (seats) => (connectedSeats = seats));

  dieSlots.forEach((slot, i) => {
    slot.addEventListener("click", () => {
      if (!slot.classList.contains("clickable")) return;
      game.toggleSelect(i);
    });
  });
  // Dice can also be picked by clicking/tapping them on the 3D table.
  game.dice3d.isDieClickable = (i) => dieSlots[i].classList.contains("clickable");
  game.dice3d.onDieClick = (i) => game.toggleSelect(i);
  document.getElementById("targetLabel").textContent = `to ${fmt(targetScore)}`;

  rollBtn.addEventListener("click", () => game.rollDice());
  bankBtn.addEventListener("click", () => game.humanBank());
  confirmBtn.addEventListener("click", () => game.confirmHold());
  continueFillBtn.addEventListener("click", () => game.humanContinueAfterFill());
  bankFillBtn.addEventListener("click", () => {
    fillPrompt.classList.add("hidden");
    game.humanBank();
  });
  playAgainBtn.addEventListener("click", () => window.location.reload());
  // In-game confirm (not window.confirm, which some embedded/mobile
  // browsers block or auto-dismiss).
  const leaveModal = document.getElementById("leaveModal");
  mainMenuBtn.addEventListener("click", () => leaveModal.classList.remove("hidden"));
  document.getElementById("leaveCancelBtn").addEventListener("click", () => leaveModal.classList.add("hidden"));
  leaveModal.addEventListener("click", (e) => {
    if (e.target === leaveModal) leaveModal.classList.add("hidden");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") leaveModal.classList.add("hidden");
  });
  document.getElementById("leaveConfirmBtn").addEventListener("click", () => {
    netInfo?.net.leaveRoom();
    window.location.reload();
  });

  // Table scene picker + sound toggle (both per-device, cosmetic only).
  const sceneSel = document.getElementById("sceneSel");
  sceneSel.innerHTML = "";
  for (const s of Dice3D.scenes) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    sceneSel.appendChild(opt);
  }
  sceneSel.value = getSceneId();
  sceneSel.addEventListener("change", () => game.dice3d.setScene(sceneSel.value));

  // debug handle for inspecting game/dice state from the console
  window.__game = game;
}

// Online only: who's connected, this device's own connection, and the
// "waiting for X" banner -- with a way to let the CPU take over a seat whose
// player has been gone a while, so nobody's stuck waiting.
const TAKEOVER_AFTER_MS = 15000;
function watchConnections(game, net, seatPlayers, rerender, setSeats) {
  const waitBanner = document.getElementById("waitBanner");
  const waitText = document.getElementById("waitText");
  const takeOverBtn = document.getElementById("takeOverBtn");
  const netBadge = document.getElementById("netBadge");

  let seats = seatPlayers.map(() => true);
  const offlineSince = new Map(); // seat -> time first seen offline
  net.subscribePlayers((list) => {
    const byId = new Map(list.map((p) => [p.id, p]));
    seats = seatPlayers.map((p) => p.type === "cpu" || !!byId.get(p.fbId)?.connId);
    seats.forEach((on, i) => {
      if (on) offlineSince.delete(i);
      else if (!offlineSince.has(i)) offlineSince.set(i, Date.now());
    });
    setSeats(seats);
    rerender();
    refresh();
  });

  net.onConnectionChange((on) => {
    netBadge.classList.toggle("hidden", on);
    refresh();
  });

  let busy = false;
  takeOverBtn.addEventListener("click", async () => {
    const seat = Number(takeOverBtn.dataset.seat);
    busy = true;
    takeOverBtn.disabled = true;
    await game.takeOverSeat(seat);
    busy = false;
    takeOverBtn.disabled = false;
    refresh();
  });

  function refresh() {
    const seat = game.awaitingSeat;
    const p = seat === null ? null : game.players[seat];
    const gone = p && !game.gameOver && !seats[seat] && net.connected;
    waitBanner.classList.toggle("hidden", !gone);
    if (!gone) return;
    waitText.textContent = `${p.name} seems to have lost connection. Waiting for them to come back…`;
    const waited = Date.now() - (offlineSince.get(seat) ?? Date.now());
    const canTake = waited >= TAKEOVER_AFTER_MS && !busy;
    takeOverBtn.classList.toggle("hidden", !canTake);
    takeOverBtn.dataset.seat = String(seat);
    takeOverBtn.textContent = `Let the CPU play for ${p.name}`;
  }
  setInterval(refresh, 1000);
}

// Tiny drawn dice for the scoring cheat sheet (<span class="mini-dice" data-v="111">).
const MINI_PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
for (const el of document.querySelectorAll(".mini-dice")) {
  for (const ch of el.dataset.v) {
    const die = document.createElement("span");
    die.className = "mini-die";
    for (let i = 0; i < 9; i++) {
      const pip = document.createElement("i");
      if (MINI_PIPS[ch].includes(i)) pip.className = "on";
      die.appendChild(pip);
    }
    el.appendChild(die);
  }
}

// Browsers keep audio locked until the first tap/click; any one will do.
document.addEventListener("pointerdown", unlockAudio, { passive: true });
document.addEventListener("keydown", unlockAudio);
