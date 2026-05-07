/**
 * server.js — Kluster Magnate multiplayer server
 * Node.js + Socket.IO
 *
 * Run:  node server.js
 * Also serves static game files on http://localhost:3001
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Serve static game files
app.use(cors());
app.use(express.static(path.join(__dirname)));

// ── Room management ─────────────────────────────────────────
const rooms = new Map(); // code -> room

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoom(hostSocket, hostName) {
  let code;
  do { code = generateCode(); } while (rooms.has(code));

  const room = {
    code,
    players: [
      { id: 1, name: hostName, socketId: hostSocket.id, magnets: 12 }
    ],
    magnetCount: 12,
    currentPlayer: 1,
    gameStarted: false
  };
  rooms.set(code, room);
  return room;
}

// ── Socket events ───────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('room:create', ({ playerName, magnetCount = 12 }) => {
    const room = createRoom(socket, playerName || 'Player 1');
    room.magnetCount = magnetCount;
    socket.join(room.code);
    socket.emit('room:created', { code: room.code, playerId: 1 });
    console.log(`[ROOM] Created ${room.code} by ${playerName}`);
  });

  socket.on('room:join', ({ code, playerName }) => {
    const room = rooms.get(code);
    if (!room) {
      socket.emit('error', `Room "${code}" not found.`);
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('error', 'Room is full.');
      return;
    }
    if (room.gameStarted) {
      socket.emit('error', 'Game already started.');
      return;
    }

    room.players.push({
      id: 2, name: playerName || 'Player 2',
      socketId: socket.id, magnets: room.magnetCount
    });

    socket.join(code);
    socket.emit('room:joined', { code, playerId: 2, players: room.players });
    io.to(code).emit('room:player_joined', { players: room.players });

    // Auto-start when 2 players
    if (room.players.length === 2) {
      room.gameStarted = true;
      setTimeout(() => {
        io.to(code).emit('game:start', {
          players: room.players,
          magnetCount: room.magnetCount
        });
        console.log(`[GAME] Started in room ${code}`);
      }, 800);
    }
  });

  socket.on('game:place', ({ roomCode, x, y, magnetId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    // Broadcast to others
    socket.to(roomCode).emit('game:place', {
      x, y, playerId: player.id, magnetId
    });
  });

  socket.on('game:snap', ({ roomCode, ...data }) => {
    socket.to(roomCode).emit('game:snap', data);
  });

  socket.on('game:turn', ({ roomCode, currentPlayer }) => {
    const room = rooms.get(roomCode);
    if (room) room.currentPlayer = currentPlayer;
    socket.to(roomCode).emit('game:turn', { currentPlayer });
  });

  socket.on('game:over', ({ roomCode, winnerId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const winner = room.players.find(p => p.id === winnerId);
    io.to(roomCode).emit('game:over', {
      winnerId,
      winnerName: winner ? winner.name : 'Player'
    });
    // Cleanup room after 30s
    setTimeout(() => rooms.delete(roomCode), 30000);
  });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    // Notify rooms this player was in
    for (const [code, room] of rooms.entries()) {
      const idx = room.players.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) {
        const leaving = room.players[idx];
        socket.to(code).emit('error', `${leaving.name} disconnected.`);
        rooms.delete(code);
      }
    }
  });
});

// ── Cleanup old rooms every 5 minutes ──────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    // Remove rooms older than 30 minutes (add createdAt tracking if needed)
    if (!room.gameStarted && room.players.length === 1) {
      // Remove rooms with only host after 5 min
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   🧲 KLUSTER MAGNATE — Game Server       ║
║   Running on http://localhost:${PORT}       ║
║   Open this URL in your browser to play  ║
╚══════════════════════════════════════════╝
  `);
});
