/**
 * multiplayer.js — Socket.IO online multiplayer layer
 * Connects to the Node.js server defined in server.js
 */

const Multiplayer = (() => {
  let socket = null;
  let roomCode = null;
  let myPlayerId = null;
  let isOnline = false;

  // Connect to the same origin that served the page
  const SERVER_URL = window.location.origin;

  let callbacks = {};

  function connect(playerName) {
    return new Promise((resolve, reject) => {
      try {
        socket = io(SERVER_URL, {
          transports: ['websocket', 'polling'],
          timeout: 5000,
          reconnectionAttempts: 3
        });

        socket.on('connect', () => {
          console.log('[MP] Connected:', socket.id);
          UI.setConnStatus('connected', 'Connected');
          resolve(socket);
        });

        socket.on('connect_error', (err) => {
          console.warn('[MP] Connection error:', err.message);
          UI.setConnStatus('error', 'Server offline — Local mode only');
          reject(err);
        });

        socket.on('disconnect', () => {
          console.log('[MP] Disconnected');
          UI.setConnStatus('', 'Disconnected');
        });

        // Room events
        socket.on('room:created', ({ code, playerId }) => {
          roomCode = code;
          myPlayerId = playerId;
          UI.setRoomCode(code);
          if (callbacks.onRoomCreated) callbacks.onRoomCreated({ code, playerId });
        });

        socket.on('room:joined', ({ code, playerId, players }) => {
          roomCode = code;
          myPlayerId = playerId;
          if (callbacks.onRoomJoined) callbacks.onRoomJoined({ code, playerId, players });
        });

        socket.on('room:player_joined', ({ players }) => {
          if (callbacks.onPlayerJoined) callbacks.onPlayerJoined({ players });
        });

        socket.on('game:start', ({ players, magnetCount }) => {
          if (callbacks.onGameStart) callbacks.onGameStart({ players, magnetCount });
        });

        socket.on('game:place', ({ x, y, playerId, magnetId }) => {
          if (callbacks.onRemotePlace) callbacks.onRemotePlace({ x, y, playerId, magnetId });
        });

        socket.on('game:snap', (data) => {
          if (callbacks.onRemoteSnap) callbacks.onRemoteSnap(data);
        });

        socket.on('game:turn', ({ currentPlayer }) => {
          if (callbacks.onTurnChange) callbacks.onTurnChange({ currentPlayer });
        });

        socket.on('game:over', (data) => {
          if (callbacks.onGameOver) callbacks.onGameOver(data);
        });

        socket.on('error', (msg) => {
          console.error('[MP] Server error:', msg);
          alert('Server error: ' + msg);
        });

      } catch(e) {
        reject(e);
      }
    });
  }

  function createRoom(playerName) {
    if (!socket) return;
    socket.emit('room:create', { playerName });
  }

  function joinRoom(code, playerName) {
    if (!socket) return;
    socket.emit('room:join', { code: code.toUpperCase(), playerName });
  }

  function sendPlace(x, y, magnetId) {
    if (!socket || !isOnline) return;
    socket.emit('game:place', { roomCode, x, y, magnetId });
  }

  function sendSnap(data) {
    if (!socket || !isOnline) return;
    socket.emit('game:snap', { roomCode, ...data });
  }

  function on(event, cb) { callbacks[event] = cb; }
  function getMyPlayerId() { return myPlayerId; }
  function getRoomCode() { return roomCode; }
  function setOnline(v) { isOnline = v; }
  function disconnect() { if (socket) socket.disconnect(); }

  return {
    connect, createRoom, joinRoom, sendPlace, sendSnap,
    on, getMyPlayerId, getRoomCode, setOnline, disconnect
  };
})();
