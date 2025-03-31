const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Player = require('./models/Player');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

const MAX_POSITION = 10;

// New: Room management
const rooms = {}; // { roomCode: { players: {}, gameState: {}, maxPlayers: number, timer: null } }

app.get('/', (req, res) => {
  res.send('Socket.IO server is running');
});

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/multiplayer-game', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

io.on('connection', (socket) => {
  console.log('A player connected:', socket.id);

  // New: Create a room
  socket.on('createRoom', ({ maxPlayers }) => {
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit code
    rooms[roomCode] = {
      players: { [socket.id]: { id: socket.id, position: 5, speedBoost: false, penaltyTime: 0 } },
      gameState: {
        walls: [
          { position: Math.floor(Math.random() * 4) + 1, hits: 0, maxHits: 3 },
          { position: Math.floor(Math.random() * 4) + 6, hits: 0, maxHits: 3 },
        ],
        powerUp: null,
        penaltyZones: [2, 7],
        started: false,
      },
      maxPlayers,
      timer: null,
    };
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, maxPlayers });
    console.log(`Room ${roomCode} created by ${socket.id} with max ${maxPlayers} players`);
  });

  // New: Join a room
  socket.on('joinRoom', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    if (Object.keys(room.players).length >= room.maxPlayers) {
      socket.emit('error', 'Room is full');
      return;
    }
    if (room.gameState.started) {
      socket.emit('error', 'Game has already started');
      return;
    }
    room.players[socket.id] = { id: socket.id, position: 5, speedBoost: false, penaltyTime: 0 };
    socket.join(roomCode);
    io.to(roomCode).emit('updatePlayers', { players: Object.values(room.players), gameState: room.gameState });
    socket.emit('joinedRoom', { roomCode, maxPlayers: room.maxPlayers });
    console.log(`Player ${socket.id} joined room ${roomCode}`);

    // New: Start timer if room is full
    if (Object.keys(room.players).length === room.maxPlayers) {
      startGameCountdown(roomCode);
    }
  });

  socket.on('setUserInfo', async ({ username, avatar }) => {
    try {
      let player = await Player.findOne({ socketId: socket.id });
      if (!player) {
        player = new Player({ socketId: socket.id, username, avatar });
        await player.save();
      } else {
        player.username = username;
        player.avatar = avatar;
        await player.save();
      }
      const roomCode = getPlayerRoom(socket.id);
      if (roomCode) {
        rooms[roomCode].players[socket.id].username = username;
        rooms[roomCode].players[socket.id].avatar = avatar;
        io.to(roomCode).emit('updatePlayers', { players: Object.values(rooms[roomCode].players), gameState: rooms[roomCode].gameState });
      }
    } catch (err) {
      console.error('Error setting user info:', err);
    }
  });

  socket.on('sendMessage', (message) => {
    const roomCode = getPlayerRoom(socket.id);
    if (roomCode) {
      const player = rooms[roomCode].players[socket.id];
      const chatMessage = {
        username: player.username || player.id.slice(0, 8),
        avatar: player.avatar,
        message,
        timestamp: Date.now(),
      };
      io.to(roomCode).emit('newMessage', chatMessage);
    }
  });

  socket.on('moveLeft', () => {
    const roomCode = getPlayerRoom(socket.id);
    if (roomCode && rooms[roomCode].gameState.started) {
      const player = rooms[roomCode].players[socket.id];
      if (player.position > 0) {
        player.position -= 1;
        checkPowerUp(socket.id, roomCode);
        checkPenalty(socket.id, roomCode);
        io.to(roomCode).emit('updatePlayers', { players: Object.values(rooms[roomCode].players), gameState: rooms[roomCode].gameState });
      }
    }
  });

  socket.on('moveRight', async () => {
    const roomCode = getPlayerRoom(socket.id);
    if (roomCode && rooms[roomCode].gameState.started) {
      const player = rooms[roomCode].players[socket.id];
      const currentPosition = player.position;
      let nextPosition = currentPosition + 1;

      if (player.speedBoost && nextPosition < MAX_POSITION) {
        nextPosition += 1;
        player.speedBoost = false;
        console.log(`Player ${socket.id} used speed boost in room ${roomCode}`);
      }

      const wall = rooms[roomCode].gameState.walls.find(w => w.position === nextPosition);
      if (wall && wall.hits < wall.maxHits) {
        wall.hits += 1;
        console.log(`Player ${socket.id} hit wall at ${wall.position} in room ${roomCode}`);
        if (wall.hits === wall.maxHits) {
          rooms[roomCode].gameState.walls = rooms[roomCode].gameState.walls.filter(w => w.position !== wall.position);
        }
        io.to(roomCode).emit('updatePlayers', { players: Object.values(rooms[roomCode].players), gameState: rooms[roomCode].gameState });
      } else if (nextPosition <= MAX_POSITION && !rooms[roomCode].gameState.walls.some(w => w.position === nextPosition && w.hits < w.maxHits)) {
        player.position = nextPosition;
        checkPowerUp(socket.id, roomCode);
        checkPenalty(socket.id, roomCode);
        io.to(roomCode).emit('updatePlayers', { players: Object.values(rooms[roomCode].players), gameState: rooms[roomCode].gameState });
        if (nextPosition === MAX_POSITION) {
          let winnerUsername = player.username || 'Anonymous';
          try {
            const dbPlayer = await Player.findOneAndUpdate(
              { socketId: socket.id },
              { $inc: { wins: 1 } },
              { new: true, upsert: true }
            );
            winnerUsername = dbPlayer.username || 'Anonymous';
          } catch (err) {
            console.error('Error updating winner:', err);
          }
          io.to(roomCode).emit('gameOver', { winnerId: socket.id, username: winnerUsername });
        }
      }
    }
  });

  // New: Room-specific helper functions
  function getPlayerRoom(playerId) {
    return Object.keys(rooms).find(code => rooms[code].players[playerId]);
  }

  function checkPowerUp(playerId, roomCode) {
    const room = rooms[roomCode];
    if (room.gameState.powerUp && room.players[playerId].position === room.gameState.powerUp.position) {
      room.players[playerId].speedBoost = true;
      room.gameState.powerUp = null;
      console.log(`Player ${playerId} collected speed boost in room ${roomCode}`);
      setTimeout(() => spawnPowerUp(roomCode), 5000);
    }
  }

  function checkPenalty(playerId, roomCode) {
    const room = rooms[roomCode];
    const player = room.players[playerId];
    if (room.gameState.penaltyZones.includes(player.position)) {
      player.penaltyTime += 1;
      if (player.penaltyTime >= 3) {
        console.log(`Player ${playerId} penalized at ${player.position} in room ${roomCode}`);
        Player.findOneAndUpdate(
          { socketId: playerId },
          { $inc: { wins: -1 } },
          { new: true }
        ).catch(err => console.error('Error applying penalty:', err));
        player.penaltyTime = 0;
      }
    } else {
      player.penaltyTime = 0;
    }
  }

  function spawnPowerUp(roomCode) {
    const room = rooms[roomCode];
    if (!room.gameState.powerUp) {
      const availablePositions = Array.from({ length: MAX_POSITION + 1 }, (_, i) => i)
        .filter(p => !room.gameState.walls.some(w => w.position === p) && !room.gameState.penaltyZones.includes(p));
      room.gameState.powerUp = {
        position: availablePositions[Math.floor(Math.random() * availablePositions.length)],
      };
      console.log(`Power-up spawned at ${room.gameState.powerUp.position} in room ${roomCode}`);
      io.to(roomCode).emit('updatePlayers', { players: Object.values(room.players), gameState: room.gameState });
    }
  }

  function startGameCountdown(roomCode) {
    const room = rooms[roomCode];
    if (!room.timer) {
      let countdown = 10;
      io.to(roomCode).emit('countdown', countdown);
      room.timer = setInterval(() => {
        countdown -= 1;
        io.to(roomCode).emit('countdown', countdown);
        if (countdown <= 0) {
          clearInterval(room.timer);
          room.timer = null;
          room.gameState.started = true;
          spawnPowerUp(roomCode);
          io.to(roomCode).emit('gameStarted');
          console.log(`Game started in room ${roomCode}`);
        }
      }, 1000);
    }
  }

  socket.on('resetGame', () => {
    const roomCode = getPlayerRoom(socket.id);
    if (roomCode) {
      const room = rooms[roomCode];
      for (const playerId in room.players) {
        room.players[playerId].position = 5;
        room.players[playerId].speedBoost = false;
        room.players[playerId].penaltyTime = 0;
      }
      room.gameState = {
        walls: [
          { position: Math.floor(Math.random() * 4) + 1, hits: 0, maxHits: 3 },
          { position: Math.floor(Math.random() * 4) + 6, hits: 0, maxHits: 3 },
        ],
        powerUp: null,
        penaltyZones: [2, 7],
        started: false,
      };
      if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
      }
      io.to(roomCode).emit('updatePlayers', { players: Object.values(room.players), gameState: room.gameState });
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    const roomCode = getPlayerRoom(socket.id);
    if (roomCode) {
      delete rooms[roomCode].players[socket.id];
      if (Object.keys(rooms[roomCode].players).length === 0) {
        delete rooms[roomCode];
        console.log(`Room ${roomCode} deleted`);
      } else {
        io.to(roomCode).emit('playerLeft', { id: socket.id });
        if (rooms[roomCode].timer) {
          clearInterval(rooms[roomCode].timer);
          rooms[roomCode].timer = null;
          io.to(roomCode).emit('countdownStopped');
        }
      }
    }
  });
});

async function getLeaderboard() {
  const topPlayers = await Player.find().sort({ wins: -1 }).limit(5);
  return topPlayers.map((p) => ({ username: p.username, wins: p.wins }));
}

io.on('connection', (socket) => {
  socket.on('getLeaderboard', async () => {
    const leaderboard = await getLeaderboard();
    socket.emit('leaderboard', { leaderboard });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});