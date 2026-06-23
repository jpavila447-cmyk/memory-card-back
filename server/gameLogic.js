const pairs = [
  {
    pairId: 1,
    cards: [
      {
        text: 'Charges',
        image: '/assets/cards/bull.jpg'
      },
      {
        text: 'Charges',
        image: '/assets/cards/bull.jpg'
      }
    ]
  },
  {
    pairId: 2,
    cards: [
      {
        text: 'Leaps',
        image: '/assets/cards/frog.png'
      },
      {
        text: 'Leaps',
        image: '/assets/cards/frog.png'
      }
    ]
  },
  {
    pairId: 3,
    cards: [
      {
        text: 'Prowls',
        image: '/assets/cards/lion.jpg'
      },
      {
        text: "Prowls",
        image: '/assets/cards/lion.jpg'
      }
    ]
  },
  {
    pairId: 4,
    cards: [
      {
        text: 'Waddle',
        image: '/assets/cards/goose.jpg'
      },
      {
        text: 'Waddle',
        image: '/assets/cards/goose.jpg'
      }
    ]
  },
  {
    pairId: 5,
    cards: [
      {
        text: 'Runs',
        image: '/assets/cards/dog.jpg'
      },
      {
        text: 'Runs',
        image: '/assets/cards/dog.jpg'
      }
    ]
  },
  {
    pairId: 6,
    cards: [
      {
        text: 'Steals',
        image: '/assets/cards/cat.png'
      },
      {
        text: 'Steals',
        image: '/assets/cards/cat.png'
      }
    ]
  },
    {
    pairId: 7,
    cards: [
      {
        text: 'Flits',
        image: '/assets/cards/bee.jpg'
      },
      {
        text: 'Flits',
        image: '/assets/cards/bee.jpg'
      }
    ]
  },
  {
    pairId: 8,
    cards: [
      {
        text: 'Slithers',
        image: '/assets/cards/snake.jpg'
      },
      {
        text: 'Slithers',
        image: '/assets/cards/snake.jpg'
      }
    ]
  },
  {
    pairId: 9,
    cards: [
      {
        text: 'Trots',
        image: '/assets/cards/pig.jpg'
      },
      {
        text: 'Trots',
        image: '/assets/cards/pig.jpg'
      }
    ]
  },
  {
    pairId: 9,
    cards: [
      {
        text: 'Lumbers',
        image: '/assets/cards/bear.jpg'
      },
      {
        text: 'Lumbers',
        image: '/assets/cards/bear.jpg'
      }
    ]
  },
];

function generateCards() {
  const cards = pairs.flatMap(pair =>
    pair.cards.map(card => ({
      pairId: pair.pairId,
      text: card.text,
      image: card.image
    }))
  );

  // Fisher-Yates shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards;
}

function startGame(room, io, serializeRoom) {

  room.gameState = {
    cards: generateCards()
  };

  room.players.forEach(p => {
    p.score = 0;
    p.timeLeft = 180000; // ⏱️ 3 minutes
  });

  room.players.sort(() => Math.random() - 0.5);

  room.turnIndex = 0;
  room.flipped = [];
  room.matched = [];
  room.gameOver = false;
  room.winner = null;

  room.turnStart = Date.now(); // ✅ IMPORTANT

  startTurnTimer(room, io, serializeRoom);
}

function currentPlayer(room) {
  return room.players[room.turnIndex];
}

function nextTurn(room, io, serializeRoom) {
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.turnStart = Date.now(); // ✅ reset turn time
  startTurnTimer(room, io, serializeRoom);
}

// 🏁 GAME END CHECK
function checkGameEnd(room, io, serializeRoom) {
  const allOut = room.players.every(p => p.timeLeft <= 0);

  const totalCards = room.gameState.cards.length;
  const allMatched = room.matched.length === totalCards;

  // ✅ NEW condition
  if (!allOut && !allMatched) return false;

  room.gameOver = true;

  // 🏆 determine winner
  const [p1, p2] = room.players;

  if (p1.score > p2.score) {
    room.winner = p1.id;
  } else if (p2.score > p1.score) {
    room.winner = p2.id;
  } else {
    room.winner = null;
  }

  io.to(room.id).emit('game-state', serializeRoom(room));
  io.to(room.id).emit('game-ended', {
    winner: room.winner,
    players: room.players
  });

  return true;
}

function startTurnTimer(room, io, serializeRoom) {
  if (room.timer) clearTimeout(room.timer);

  const player = currentPlayer(room);
  room.turnStart = Date.now();

  room.timer = setTimeout(() => {

    const elapsed = Date.now() - room.turnStart;
    player.timeLeft -= elapsed;

    if (player.timeLeft <= 0) {
      player.timeLeft = 0;
    }

    if (checkGameEnd(room, io, serializeRoom)) return;

    room.flipped = [];
    nextTurn(room, io, serializeRoom);

    io.to(room.id).emit('game-state', serializeRoom(room));

  }, 10000); // ⏱️ turn max
}

function handleFlip(room, index, socketId, io, serializeRoom) {
  if (room.gameOver) return;

  const player = currentPlayer(room);
  if (player.id !== socketId) return;

  // 🛑 stop timer
  if (room.timer) clearTimeout(room.timer);

  // ⏱️ subtract elapsed time
  const elapsed = Date.now() - room.turnStart;
  player.timeLeft -= elapsed;

  if (player.timeLeft <= 0) {
    player.timeLeft = 0;

    if (checkGameEnd(room, io, serializeRoom)) return;

    nextTurn(room, io, serializeRoom);
    return;
  }

  if (room.flipped.includes(index) || room.matched.includes(index)) return;

  room.flipped.push(index);

  const cards = room.gameState.cards;

  if (room.flipped.length === 2) {
    const [i1, i2] = room.flipped;

    const c1 = cards[i1];
    const c2 = cards[i2];

    // ✅ MATCH
    if (c1.pairId === c2.pairId) {
      room.matched.push(i1, i2);
      player.score += 1;

      room.flipped = [];

      if (checkGameEnd(room, io, serializeRoom)) return;

      startTurnTimer(room, io, serializeRoom);

    } else {
      setTimeout(() => {
        room.flipped = [];

        if (checkGameEnd(room, io, serializeRoom)) return;

        nextTurn(room, io, serializeRoom);

        io.to(room.id).emit('game-state', serializeRoom(room));
      }, 1000);
    }

  } else {
    // ✅ IMPORTANT: restart timer after first flip
    startTurnTimer(room, io, serializeRoom);
  }

  // ✅ ALWAYS EMIT STATE
  io.to(room.id).emit('game-state', serializeRoom(room));
}

module.exports = {
  startGame,
  handleFlip
};