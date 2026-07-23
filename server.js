const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.status(200).send('ok'));

// ---- Configuração do jogo ----
const GRID_COLS = 60;
const GRID_ROWS = 40;
const TICK_RATE_MS = 90;
const MAX_PLAYERS = 8;
const MIN_PLAYERS_TO_START = 2;
const FOOD_COUNT = 25;
const START_GROWTH = 1; // segmentos extras que a cobra ganha ao nascer (tamanho inicial pequeno)
const COUNTDOWN_SECONDS = 3;
const ROUND_END_DISPLAY_MS = 4000;
const ROUND_WIN_BONUS = 5; // pontos extras para quem vence a rodada
const OBSTACLE_INTERVAL_MS = 8000; // cria um novo obstáculo a cada x segundos
const OBSTACLE_MAX = 30;
const SPAWN_MARGIN = 10; // distância mínima da lava ao nascer, para dar tempo de reação

const COLORS = [
  '#ff5555', '#50fa7b', '#8be9fd', '#ffb86c',
  '#bd93f9', '#ff79c6', '#f1fa8c', '#00d1ff'
];

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

/** @type {Map<string, Player>} */
const players = new Map();
let food = []; // [{x,y}]
let obstacles = []; // [{x,y}]
let roundState = 'waiting'; // waiting | countdown | playing | ended
let hostId = null;
let roundTimer = null;
let obstacleTimer = null;
let tickInterval = null;

function isCellFree(x, y, ignoreFood = false) {
  if (!ignoreFood && food.some(f => f.x === x && f.y === y)) return false;
  if (obstacles.some(o => o.x === x && o.y === y)) return false;
  for (const p of players.values()) {
    if (p.body.some(seg => seg.x === x && seg.y === y)) return false;
  }
  return true;
}

function randomEmptyCell(margin = 0) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const x = margin + Math.floor(Math.random() * (GRID_COLS - margin * 2));
    const y = margin + Math.floor(Math.random() * (GRID_ROWS - margin * 2));
    if (isCellFree(x, y)) return { x, y };
  }
  return { x: Math.floor(GRID_COLS / 2), y: Math.floor(GRID_ROWS / 2) };
}

function spawnFood() {
  while (food.length < FOOD_COUNT) {
    food.push(randomEmptyCell(1));
  }
}

function spawnObstacle() {
  if (obstacles.length >= OBSTACLE_MAX) return;
  obstacles.push(randomEmptyCell(3));
}

function startObstacleTimer() {
  clearInterval(obstacleTimer);
  obstacleTimer = setInterval(() => {
    if (roundState === 'playing') spawnObstacle();
  }, OBSTACLE_INTERVAL_MS);
}

function nextColor() {
  const used = new Set([...players.values()].map(p => p.color));
  return COLORS.find(c => !used.has(c)) || COLORS[players.size % COLORS.length];
}

function spawnPlayer(player) {
  const cell = randomEmptyCell(SPAWN_MARGIN);
  const dirKeys = Object.keys(DIRECTIONS);
  const dir = DIRECTIONS[dirKeys[Math.floor(Math.random() * dirKeys.length)]];
  player.body = [{ x: cell.x, y: cell.y }];
  player.dir = dir;
  player.pendingDir = dir;
  player.alive = true;
  player.spectating = false;
  player.growth = START_GROWTH;
}

function connectedCount() {
  return players.size;
}

function aliveCount() {
  let n = 0;
  for (const p of players.values()) if (p.alive) n++;
  return n;
}

function broadcastRoundEvent(type, payload = {}) {
  io.emit('roundEvent', { type, ...payload });
}

function resetRoundIfPossible() {
  clearRoundTimer();
  if (connectedCount() >= MIN_PLAYERS_TO_START) {
    startCountdown();
  } else {
    roundState = 'waiting';
    broadcastRoundEvent('waiting', { needed: MIN_PLAYERS_TO_START });
  }
}

function clearRoundTimer() {
  if (roundTimer) {
    clearTimeout(roundTimer);
    roundTimer = null;
  }
}

function startCountdown() {
  roundState = 'countdown';
  let remaining = COUNTDOWN_SECONDS;
  broadcastRoundEvent('countdown', { seconds: remaining });
  clearRoundTimer();
  const step = () => {
    remaining -= 1;
    if (remaining <= 0) {
      startRound();
    } else {
      broadcastRoundEvent('countdown', { seconds: remaining });
      roundTimer = setTimeout(step, 1000);
    }
  };
  roundTimer = setTimeout(step, 1000);
}

function startRound() {
  food = [];
  obstacles = [];
  for (const p of players.values()) {
    spawnPlayer(p);
  }
  spawnFood();
  roundState = 'playing';
  broadcastRoundEvent('start');
  startObstacleTimer();
}

function endRound(winner) {
  roundState = 'ended';
  if (winner) winner.score += ROUND_WIN_BONUS;
  broadcastRoundEvent('end', { winner: winner ? winner.nickname : null });
  clearInterval(obstacleTimer);
  clearRoundTimer();
  roundTimer = setTimeout(() => {
    resetRoundIfPossible();
  }, ROUND_END_DISPLAY_MS);
  io.emit('state', serializeState());
}

function tick() {
  if (roundState !== 'playing') return;

  const alivePlayers = [...players.values()].filter(p => p.alive);

  // Fase 1: aplica direção pendente e calcula nova cabeça
  const newHeads = new Map();
  for (const p of alivePlayers) {
    p.dir = p.pendingDir;
    const head = p.body[0];
    newHeads.set(p.id, { x: head.x + p.dir.x, y: head.y + p.dir.y });
  }

  // Fase 2: detecta colisões
  const deaths = new Set();
  for (const p of alivePlayers) {
    const head = newHeads.get(p.id);

    if (head.x <= 0 || head.x >= GRID_COLS - 1 || head.y <= 0 || head.y >= GRID_ROWS - 1) {
      deaths.add(p.id);
      continue;
    }

    if (obstacles.some(o => o.x === head.x && o.y === head.y)) {
      deaths.add(p.id);
      continue;
    }

    for (const other of alivePlayers) {
      const bodyToCheck = other.id === p.id ? other.body.slice(0, -1) : other.body;
      if (bodyToCheck.some(seg => seg.x === head.x && seg.y === head.y)) {
        deaths.add(p.id);
      }
    }
  }

  // Cabeça-com-cabeça: dois jogadores miram a mesma célula
  for (let i = 0; i < alivePlayers.length; i++) {
    for (let j = i + 1; j < alivePlayers.length; j++) {
      const a = newHeads.get(alivePlayers[i].id);
      const b = newHeads.get(alivePlayers[j].id);
      if (a.x === b.x && a.y === b.y) {
        deaths.add(alivePlayers[i].id);
        deaths.add(alivePlayers[j].id);
      }
    }
  }

  // Fase 3: aplica movimento para quem sobreviveu, come comida se for o caso
  for (const p of alivePlayers) {
    if (deaths.has(p.id)) continue;
    const head = newHeads.get(p.id);
    const ateIndex = food.findIndex(f => f.x === head.x && f.y === head.y);
    p.body.unshift(head);
    if (ateIndex !== -1) {
      food.splice(ateIndex, 1);
      p.score += 1;
      p.growth += 1;
    }
    if (p.growth > 0) {
      p.growth -= 1;
    } else {
      p.body.pop();
    }
  }

  // Fase 4: mata quem colidiu, corpo vira comida
  for (const id of deaths) {
    const p = players.get(id);
    if (!p) continue;
    p.alive = false;
    for (const seg of p.body) {
      if (Math.random() < 0.5) food.push(seg);
    }
    p.body = [];
  }

  spawnFood();

  // Fase 5: checa fim de rodada
  const stillAlive = [...players.values()].filter(p => p.alive);
  if (stillAlive.length <= 1 && alivePlayers.length >= 1 && [...players.values()].length >= MIN_PLAYERS_TO_START) {
    endRound(stillAlive[0] || null);
  }

  io.emit('state', serializeState());
}

function serializeState() {
  return {
    grid: { cols: GRID_COLS, rows: GRID_ROWS },
    roundState,
    hostId,
    food,
    obstacles,
    players: [...players.values()].map(p => ({
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      body: p.body,
      alive: p.alive,
      spectating: p.spectating,
      score: p.score
    }))
  };
}

io.on('connection', socket => {
  socket.on('join', ({ nickname }) => {
    if (players.size >= MAX_PLAYERS) {
      socket.emit('joinRejected', { reason: 'Sala cheia (máximo 8 jogadores).' });
      return;
    }
    const cleanNickname = String(nickname || 'Jogador').trim().slice(0, 16) || 'Jogador';
    const player = {
      id: socket.id,
      nickname: cleanNickname,
      color: nextColor(),
      body: [],
      dir: DIRECTIONS.right,
      pendingDir: DIRECTIONS.right,
      alive: false,
      spectating: roundState === 'playing' || roundState === 'countdown',
      growth: 0,
      score: 0
    };
    players.set(socket.id, player);

    if (!hostId || !players.has(hostId)) {
      hostId = socket.id;
    }

    socket.emit('joined', { id: socket.id, grid: { cols: GRID_COLS, rows: GRID_ROWS } });
    io.emit('state', serializeState());

    if (roundState === 'waiting') {
      broadcastRoundEvent('waiting', { needed: Math.max(0, MIN_PLAYERS_TO_START - connectedCount()) });
    }
  });

  socket.on('startGame', () => {
    if (socket.id !== hostId) return;
    if (roundState !== 'waiting') return;
    if (connectedCount() < MIN_PLAYERS_TO_START) return;
    startCountdown();
  });

  socket.on('direction', dirName => {
    const player = players.get(socket.id);
    if (!player || !player.alive) return;
    const newDir = DIRECTIONS[dirName];
    if (!newDir) return;
    // impede reverter diretamente sobre o próprio corpo
    if (newDir.x === -player.dir.x && newDir.y === -player.dir.y) return;
    player.pendingDir = newDir;
  });

  socket.on('disconnect', () => {
    const wasHost = socket.id === hostId;
    players.delete(socket.id);
    if (wasHost) {
      hostId = players.size > 0 ? players.keys().next().value : null;
    }
    io.emit('state', serializeState());
    if (roundState === 'playing') {
      const stillAlive = [...players.values()].filter(p => p.alive);
      if (stillAlive.length <= 1) {
        endRound(stillAlive[0] || null);
      }
    } else {
      if (connectedCount() < MIN_PLAYERS_TO_START) {
        clearRoundTimer();
        roundState = 'waiting';
      }
      if (roundState === 'waiting') {
        broadcastRoundEvent('waiting', { needed: Math.max(0, MIN_PLAYERS_TO_START - connectedCount()) });
      }
    }
  });
});

tickInterval = setInterval(tick, TICK_RATE_MS);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
