import { Game } from "./game.js?v=32";
import { Dice3D } from "./dice3d.js?v=32";
import { getSceneId } from "./scenes/index.js?v=32";
import { unlockAudio, isMuted, setMuted } from "./sound.js?v=32";
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
      const { NetSession } = await import("./net.js?v=32");
      const net = new NetSession();
      const { playerId } = await net.createRoom(name);
      enterLobby(net, playerId);
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
      const { NetSession } = await import("./net.js?v=32");
      const net = new NetSession();
      const { playerId } = await net.joinRoom(code, name);
      enterLobby(net, playerId);
    } catch (err) {
      showFormError(joinRoomPane, err.message || "Couldn't join that room.");
    } finally {
      joinRoomBtn.disabled = false;
    }
  });
}

function enterLobby(net, myFirebasePlayerId) {
  const lobbyRoomCode = document.getElementById("lobbyRoomCode");
  const lobbyPlayers = document.getElementById("lobbyPlayers");
  const lobbyHostControls = document.getElementById("lobbyHostControls");
  const lobbyTargetScoreSel = document.getElementById("lobbyTargetScoreSel");
  const lobbyAddCpuBtn = document.getElementById("lobbyAddCpuBtn");
  const lobbyStartBtn = document.getElementById("lobbyStartBtn");
  const lobbyWaitingMsg = document.getElementById("lobbyWaitingMsg");
  const lobbyLeaveBtn = document.getElementById("lobbyLeaveBtn");

  window.__net = net; // debug handle

  setupScreen.classList.add("hidden");
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
      lobbyStartBtn.disabled = true;
      try {
        await net.startGame(players, targetScore);
      } catch (err) {
        lobbyStartBtn.disabled = false;
        window.alert("Couldn't start the game: " + (err.message || err));
      }
    });
  }

  lobbyLeaveBtn.addEventListener("click", () => {
    net.leaveRoom();
    window.location.reload();
  });

  net.startListening();
  net.next("gameStarted").then(({ players, targetScore }) => {
    const myPlayerId = players.findIndex((p) => p.fbId === myFirebasePlayerId);
    const gamePlayers = players.map(({ fbId, ...rest }) => rest);
    lobbyScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    launchGame(gamePlayers, targetScore, { net, myPlayerId });
  });
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
  const isMyTurn = () => !game || game.myPlayerId === null || game.currentPlayer.id === game.myPlayerId;

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
        el.querySelector(".p-name").textContent = p.name + (p.type === "cpu" ? " 🤖" : "");
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
          vengeanceModal.classList.add("hidden");
          vengeancePlayBtn.removeEventListener("click", onPlay);
          vengeanceDeclineBtn.removeEventListener("click", onDecline);
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
  });

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
  mainMenuBtn.addEventListener("click", () => {
    if (window.confirm("Return to the Main Menu? Your current game will be lost.")) {
      netInfo?.net.leaveRoom();
      window.location.reload();
    }
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

  const muteBtn = document.getElementById("muteBtn");
  const syncMute = () => {
    muteBtn.textContent = isMuted() ? "🔇" : "🔊";
    muteBtn.title = isMuted() ? "Sound off" : "Sound on";
  };
  syncMute();
  muteBtn.addEventListener("click", () => {
    setMuted(!isMuted());
    syncMute();
  });

  // debug handle for inspecting game/dice state from the console
  window.__game = game;
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
