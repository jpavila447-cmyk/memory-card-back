const { v4: uuidv4 } = require('uuid');

const rooms = {};

// 🏠 CREATE ROOM
function createRoom(player) {
  const roomId = uuidv4();

  rooms[roomId] = {
    id: roomId,
    players: [
      {
        id: player.id,
        name: player.name, // ✅ KEEP FROM LOBBY
        score: 0,
        timeLeft: 60000,
        isHost: true
      }
    ],
    gameState: null,
    turnIndex: 0,
    flipped: [],
    matched: [],
    timer: null,
    turnStart: null, // ⏱️ NEW
    gameOver: false, // 🏁 NEW
    winner: null     // 🏆 NEW
  };

  return rooms[roomId];
}

// 🚪 JOIN ROOM
function joinRoom(roomId, player) {
  const room = rooms[roomId];
  if (!room || room.players.length >= 2) return null;

  room.players.push({
    id: player.id,
    name: player.name, // ✅ KEEP NAME
    score: 0,
    timeLeft: 60000,
    isHost: false
  });

  return room;
}

// 🔍 GET ROOM
function getRoom(roomId) {
  return rooms[roomId];
}

// ❌ REMOVE PLAYER
function removePlayer(playerId) {
  for (const roomId in rooms) {
    const room = rooms[roomId];

    room.players = room.players.filter(p => p.id !== playerId);

    // 🧹 if room empty → cleanup
    if (room.players.length === 0) {
      if (room.timer) {
        clearTimeout(room.timer); // ✅ prevent memory leak
      }

      delete rooms[roomId];
    }
  }
}

function markDisconnected(playerId) {
  const room = findRoomByPlayer(playerId);
  if (!room) return;

  const player = room.players.find(p => p.id === playerId);
  if (!player) return;

  player.disconnected = true;

  // 🧹 clear existing timeout (important)
  if (player.disconnectTimeout) {
    clearTimeout(player.disconnectTimeout);
  }

  // ⏳ remove after 10 seconds
  player.disconnectTimeout = setTimeout(() => {
    removePlayer(playerId);
  }, 10000);
}

function findRoomByPlayer(playerId) {
  for (const roomId in rooms) {
    const room = rooms[roomId];

    const exists = room.players.some(p => p.id === playerId);

    if (exists) {
      return room;
    }
  }

  return null;
}

module.exports = {
  createRoom,
  joinRoom,
  getRoom,
  removePlayer,
  markDisconnected,
  findRoomByPlayer
};