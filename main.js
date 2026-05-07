/**
 * main.js — Game orchestration, state machine, event handlers
 */

/* ── Game State ─────────────────────────────────────────── */
const State = {
  mode: 'local',          // 'local' | 'online' | 'practice'
  players: [
    { id: 1, name: 'Player 1', magnets: 12, total: 12 },
    { id: 2, name: 'Player 2', magnets: 12, total: 12 }
  ],
  currentPlayer: 0,       // index into players array
  waitingForPlace: false,
  gameRunning: false,
  paused: false,
  magnetIdCounter: 0,
  myPlayerId: null,       // for online mode
  pendingSnap: null,      // snap data waiting for UI
};

/* ── Init ───────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  setupLobby();
  UI.showScreen('screen-lobby');
});

/* ── Lobby ──────────────────────────────────────────────── */
function setupLobby() {
  // Local match
  document.getElementById('btn-local-start').addEventListener('click', () => {
    const count = parseInt(document.getElementById('local-magnet-count').value);
    startLocalGame(count);
  });

  // Practice
  document.getElementById('btn-practice').addEventListener('click', () => {
    const count = parseInt(document.getElementById('practice-count').value);
    startPracticeMode(count);
  });

  // Online — Create room
  document.getElementById('btn-create-room').addEventListener('click', async () => {
    const name = document.getElementById('online-name').value.trim() || 'Player 1';
    await connectOnline(name);
    Multiplayer.createRoom(name);
    UI.showScreen('screen-waiting');
  });

  // Online — Join room
  document.getElementById('btn-join-room').addEventListener('click', async () => {
    const name = document.getElementById('online-name').value.trim() || 'Player';
    const code = document.getElementById('join-code').value.trim();
    if (!code) { alert('Enter a room code'); return; }
    await connectOnline(name);
    Multiplayer.joinRoom(code, name);
  });

  // Copy code
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const code = document.getElementById('room-code-display').textContent;
    navigator.clipboard.writeText(code).then(() => {
      document.getElementById('btn-copy-code').textContent = '✅ Copied!';
      setTimeout(() => { document.getElementById('btn-copy-code').textContent = '📋 Copy Code'; }, 2000);
    });
  });

  // Back from waiting
  document.getElementById('btn-back-lobby').addEventListener('click', () => {
    Multiplayer.disconnect();
    UI.showScreen('screen-lobby');
  });

  // In-game buttons
  document.getElementById('btn-pause').addEventListener('click', togglePause);
  document.getElementById('btn-resume').addEventListener('click', togglePause);
  document.getElementById('btn-quit-pause').addEventListener('click', () => {
    returnToLobby();
  });

  // Replay
  document.getElementById('btn-replay').addEventListener('click', async () => {
    document.getElementById('btn-replay').disabled = true;
    await Game.playReplay();
    document.getElementById('btn-replay').disabled = false;
  });

  document.getElementById('btn-next-turn').addEventListener('click', () => {
    UI.showReplayBar(false);
    proceedAfterSnap();
  });

  // Result screen
  document.getElementById('btn-rematch').addEventListener('click', () => {
    const count = State.players[0].total;
    if (State.mode === 'local') startLocalGame(count);
    else if (State.mode === 'practice') startPracticeMode(count);
    else UI.showScreen('screen-lobby');
  });
  document.getElementById('btn-main-menu').addEventListener('click', () => {
    returnToLobby();
  });
}

/* ── Online Connection ──────────────────────────────────── */
async function connectOnline(name) {
  const statusEl = document.getElementById('connection-status');
  statusEl.classList.remove('hidden');
  UI.setConnStatus('', 'Connecting…');

  try {
    await Multiplayer.connect(name);
    setupMultiplayerEvents(name);
  } catch (e) {
    UI.setConnStatus('error', 'Cannot reach server. Run server.js for online play.');
    setTimeout(() => statusEl.classList.add('hidden'), 4000);
  }
}

function setupMultiplayerEvents(myName) {
  Multiplayer.on('onRoomCreated', ({ code, playerId }) => {
    State.myPlayerId = playerId;
    UI.setRoomCode(code);
    UI.setWaitingPlayer(1, myName, true);
  });

  Multiplayer.on('onRoomJoined', ({ code, playerId, players }) => {
    State.myPlayerId = playerId;
    UI.setRoomCode(code);
    UI.showScreen('screen-waiting');
    players.forEach((p, i) => UI.setWaitingPlayer(i + 1, p.name, true));
  });

  Multiplayer.on('onPlayerJoined', ({ players }) => {
    players.forEach((p, i) => UI.setWaitingPlayer(i + 1, p.name, true));
  });

  Multiplayer.on('onGameStart', ({ players, magnetCount }) => {
    startOnlineGame(players, magnetCount);
  });

  Multiplayer.on('onRemotePlace', ({ x, y, playerId, magnetId }) => {
    const playerIdx = playerId - 1;
    doPlace(x, y, playerIdx, magnetId, true);
  });

  Multiplayer.on('onGameOver', (data) => {
    handleGameOver(data);
  });
}

/* ── Local Game ─────────────────────────────────────────── */
function startLocalGame(magnetCount = 12) {
  State.mode = 'local';
  State.players = [
    { id: 1, name: 'Player 1', magnets: magnetCount, total: magnetCount },
    { id: 2, name: 'Player 2', magnets: magnetCount, total: magnetCount }
  ];
  State.currentPlayer = 0;
  State.magnetIdCounter = 0;
  State.gameRunning = true;
  State.paused = false;

  initGameEngine('local');
}

/* ── Online Game ────────────────────────────────────────── */
function startOnlineGame(players, magnetCount) {
  State.mode = 'online';
  State.players = players.map((p, i) => ({
    id: i + 1, name: p.name, magnets: magnetCount, total: magnetCount
  }));
  State.currentPlayer = 0;
  State.magnetIdCounter = 0;
  State.gameRunning = true;
  Multiplayer.setOnline(true);
  initGameEngine('online');
}

/* ── Practice Mode ──────────────────────────────────────── */
function startPracticeMode(magnetCount = 20) {
  State.mode = 'practice';
  State.players = [
    { id: 1, name: 'Sandbox', magnets: magnetCount, total: magnetCount }
  ];
  State.magnetIdCounter = 0;
  State.gameRunning = true;
  initGameEngine('practice');
}

/* ── Engine bootstrap ────────────────────────────────────── */
function initGameEngine(mode) {
  State.paused = false;
  UI.showScreen('screen-game');
  UI.showPause(false);
  UI.showReplayBar(false);
  const snapOverlay = document.getElementById('overlay-snap');
  if (snapOverlay) snapOverlay.classList.add('hidden');

  const canvas = document.getElementById('game-canvas');
  syncCanvasSize(canvas);

  Game.init(canvas, {
    mode,
    onSnap:    handleSnap,
    onTurnEnd: handleTurnEnd,
    onGameOver: handleGameOver
  });

  // HUD
  State.players.forEach((p, i) => {
    UI.setPlayerName(i + 1, p.name);
    UI.setMagnetCount(i + 1, p.total, p.magnets);
  });
  updateTurnDisplay();

  if (mode === 'practice') {
    UI.setHint('Click anywhere in the arena to place magnets');
    document.getElementById('hud-p2').style.visibility = 'hidden';
  } else {
    document.getElementById('hud-p2').style.visibility = 'visible';
    UI.setHint('Click inside the arena to place your magnet');
  }

  canvas.removeEventListener('click', onCanvasClick);
  canvas.addEventListener('click', onCanvasClick);

  canvas.removeEventListener('touchend', onCanvasTouch);
  canvas.addEventListener('touchend', onCanvasTouch, { passive: false });
}

function syncCanvasSize(canvas = document.getElementById('game-canvas')) {
  if (!canvas) return;
  const gameWrap = canvas.parentElement;
  if (!gameWrap) return;
  const wrapRect = gameWrap.getBoundingClientRect();
  const size = Math.max(1, Math.min(wrapRect.width, wrapRect.height, 640));
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
}

/* ── Click/Touch to place ───────────────────────────────── */
function getCanvasPoint(event, canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const point = event.changedTouches?.[0] || event.touches?.[0] || event;
  if (!point || !rect.width || !rect.height) return null;

  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (point.clientX - rect.left) * scaleX,
    y: (point.clientY - rect.top) * scaleY
  };
}

function onCanvasClick(e) {
  if (State.paused) return;
  const point = getCanvasPoint(e, e.currentTarget);
  if (!point) return;
  handlePlaceAttempt(point.x, point.y);
}

function onCanvasTouch(e) {
  if (State.paused) return;
  e.preventDefault();
  const point = getCanvasPoint(e, e.currentTarget);
  if (!point) return;
  handlePlaceAttempt(point.x, point.y);
}

function handlePlaceAttempt(x, y) {
  if (!State.gameRunning || State.paused) return;

  const validation = Game.validatePlacement(x, y);
  if (!validation.valid) {
    UI.setHint(validation.reason);
    setTimeout(() => UI.setHint('Click inside the arena to place your magnet'), 1500);
    return;
  }

  if (State.mode === 'practice') {
    placePractice(x, y);
    return;
  }

  // Online: only place on your turn
  if (State.mode === 'online') {
    const myId = Multiplayer.getMyPlayerId();
    const currentP = State.players[State.currentPlayer];
    if (currentP.id !== myId) {
      UI.setHint("Wait for your turn!");
      return;
    }
  }

  const playerIdx = State.currentPlayer;
  const player = State.players[playerIdx];
  if (player.magnets <= 0) return;

  const magnetId = ++State.magnetIdCounter;
  doPlace(x, y, playerIdx, magnetId, false);

  if (State.mode === 'online') {
    Multiplayer.sendPlace(x, y, magnetId);
  }
}

function doPlace(x, y, playerIdx, magnetId, isRemote) {
  const player = State.players[playerIdx];
  player.magnets--;
  UI.setMagnetCount(player.id, player.total, player.magnets);
  UI.setHint('');

  Game.placeMagnet(x, y, player.id, magnetId);
}

function placePractice(x, y) {
  const magnetId = ++State.magnetIdCounter;
  // Alternate colors in practice
  const playerIdx = magnetId % 2;
  Game.placeMagnet(x, y, playerIdx + 1, magnetId);
}

/* ── Snap Handler ───────────────────────────────────────── */
function handleSnap({ culpritPlayer, connectedIds, chainCount }) {
  // Give connected magnets back to the culprit
  const culpritIdx = State.players.findIndex(p => p.id === culpritPlayer);
  if (culpritIdx !== -1) {
    State.players[culpritIdx].magnets += chainCount;
    State.players[culpritIdx].total = Math.max(
      State.players[culpritIdx].total,
      State.players[culpritIdx].magnets
    );
    UI.setMagnetCount(
      State.players[culpritIdx].id,
      State.players[culpritIdx].total,
      State.players[culpritIdx].magnets
    );
  }

  // Remove connected magnets from arena
  connectedIds.forEach(id => Game.removeMagnet(id));

  State.pendingSnap = { culpritPlayer, connectedIds, chainCount };

  // Chain reaction ends the turn after the penalty is applied.
  UI.showSnapOverlay({ culpritPlayer, chainCount }, () => {
    UI.showReplayBar(true);
  });
}

function proceedAfterSnap() {
  UI.showReplayBar(false);
  State.pendingSnap = null;

  // Switch turn after snap
  switchTurn();
  checkGameOver();
}

/* ── Turn end (clean placement) ─────────────────────────── */
function handleTurnEnd({ clean }) {
  if (!clean) return;
  switchTurn();
  checkGameOver();
}

/* ── Switch turn ────────────────────────────────────────── */
function switchTurn() {
  State.currentPlayer = (State.currentPlayer + 1) % State.players.length;
  updateTurnDisplay();
}

function updateTurnDisplay() {
  const p = State.players[State.currentPlayer];
  UI.setTurn(p.id, p.name);

  if (State.mode === 'online' && Multiplayer.getMyPlayerId() !== p.id) {
    UI.setHint(`Waiting for ${p.name} to place…`);
  } else {
    UI.setHint('Click inside the arena to place your magnet');
  }
}

/* ── Win condition ──────────────────────────────────────── */
function checkGameOver() {
  // Winner = player who placed all their magnets (magnets still in hand = 0)
  // But: players GAIN magnets from snaps, so winning is hard!
  // Win if a player reaches 0 magnets after their turn
  for (const p of State.players) {
    if (p.magnets === 0) {
      setTimeout(() => {
        const stats = Game.getStats();
        UI.showResult(
          `${p.name} Wins! 🏆`,
          'All magnets placed without triggering a chain reaction!',
          stats
        );
        State.gameRunning = false;
        AudioEngine.playWin();
      }, 400);
      return;
    }
  }
}

/* ── Game over from server / manual ─────────────────────── */
function handleGameOver(data) {
  const stats = Game.getStats();
  UI.showResult(
    `${data.winnerName || 'Player'} Wins!`,
    data.reason || '',
    stats
  );
  State.gameRunning = false;
}

/* ── Pause ──────────────────────────────────────────────── */
function togglePause() {
  State.paused = !State.paused;
  UI.showPause(State.paused);
}

/* ── Quit ───────────────────────────────────────────────── */
function quitGame() {
  State.gameRunning = false;
  State.paused = false;
  Game.destroy();
  AudioEngine.stopAllHums();
  UI.showPause(false);
  UI.showReplayBar(false);
  // Clear the canvas so it doesn't bleed through after screen switch
  const canvas = document.getElementById('game-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/* ── Return to lobby (quit + navigate) ──────────────────── */
function returnToLobby() {
  // 1. Hide overlays first
  UI.showPause(false);
  UI.showReplayBar(false);
  // 2. Switch screen immediately (removes screen-game from view)
  UI.showScreen('screen-lobby');
  // 3. Then destroy engine (safe after DOM is already switched)
  quitGame();
  Multiplayer.disconnect();
}

/* ── Keyboard shortcuts ─────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('screen-game').classList.contains('active')) {
      togglePause();
    }
  }
});

/* ── Resize handling ────────────────────────────────────── */
window.addEventListener('resize', () => {
  if (!State.gameRunning) return;
  syncCanvasSize();
});
