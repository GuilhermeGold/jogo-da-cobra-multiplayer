const CELL_SIZE = 20;

const joinScreen = document.getElementById('join-screen');
const joinForm = document.getElementById('join-form');
const nicknameInput = document.getElementById('nickname-input');
const joinError = document.getElementById('join-error');

const gameScreen = document.getElementById('game-screen');
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreboard = document.getElementById('scoreboard');
const roundMessage = document.getElementById('round-message');
const startBtn = document.getElementById('start-btn');

const socket = io({ transports: ['websocket'] });
let myId = null;
let gridCols = 0;
let gridRows = 0;
let latestState = null;
let currentRoundState = 'waiting';
let countdownValue = null;
let hostId = null;
let waitingNeeded = null;

startBtn.addEventListener('click', () => {
  socket.emit('startGame');
});

function updateStartButton() {
  const isHost = myId != null && hostId === myId;
  if (currentRoundState !== 'waiting' || !isHost) {
    startBtn.classList.add('hidden');
    return;
  }
  startBtn.classList.remove('hidden');
  const ready = waitingNeeded === 0;
  startBtn.disabled = !ready;
  startBtn.textContent = ready ? 'Iniciar partida' : 'Aguardando jogadores...';
}

joinForm.addEventListener('submit', e => {
  e.preventDefault();
  const nickname = nicknameInput.value.trim();
  if (!nickname) return;
  socket.emit('join', { nickname });
});

socket.on('joinRejected', ({ reason }) => {
  joinError.textContent = reason;
});

socket.on('joined', ({ id, grid }) => {
  myId = id;
  gridCols = grid.cols;
  gridRows = grid.rows;
  canvas.width = gridCols * CELL_SIZE;
  canvas.height = gridRows * CELL_SIZE;
  joinScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
});

socket.on('roundEvent', event => {
  currentRoundState = event.type === 'start' ? 'playing' : event.type === 'end' ? 'ended' : event.type;
  switch (event.type) {
    case 'waiting': {
      countdownValue = null;
      waitingNeeded = event.needed;
      const isHost = myId != null && hostId === myId;
      if (event.needed > 0) {
        roundMessage.textContent = `Aguardando mais ${event.needed} jogador(es) para começar...`;
      } else {
        roundMessage.textContent = isHost
          ? 'Jogadores suficientes! Inicie quando quiser.'
          : 'Aguardando o host iniciar a partida...';
      }
      break;
    }
    case 'countdown':
      countdownValue = event.seconds;
      roundMessage.textContent = `Começando em ${event.seconds}...`;
      break;
    case 'start':
      countdownValue = null;
      roundMessage.textContent = 'Vale tudo!';
      break;
    case 'end':
      countdownValue = null;
      roundMessage.textContent = event.winner
        ? `🏆 ${event.winner} venceu a rodada!`
        : 'Empate! Ninguém sobreviveu.';
      break;
  }
  updateStartButton();
});

socket.on('state', state => {
  latestState = state;
  hostId = state.hostId;
  renderScoreboard(state);
  updateStartButton();
});

function lerpColor(a, b, t) {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
}

const LAVA_DARK = [130, 20, 10];
const LAVA_BRIGHT = [255, 180, 40];

function drawLavaCell(gx, gy, seed, t) {
  const intensity = 0.5 + 0.5 * Math.sin(t * 2.5 + seed * 0.6);
  const [r, g, b] = lerpColor(LAVA_DARK, LAVA_BRIGHT, intensity);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(gx * CELL_SIZE, gy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  ctx.fillStyle = `rgba(255,120,0,${0.25 * intensity})`;
  ctx.fillRect(gx * CELL_SIZE - 2, gy * CELL_SIZE - 2, CELL_SIZE + 4, CELL_SIZE + 4);
}

function drawLavaBorder(t) {
  if (!gridCols || !gridRows) return;
  for (let x = 0; x < gridCols; x++) {
    drawLavaCell(x, 0, x, t);
    drawLavaCell(x, gridRows - 1, x + gridRows, t);
  }
  for (let y = 1; y < gridRows - 1; y++) {
    drawLavaCell(0, y, y + gridCols, t);
    drawLavaCell(gridCols - 1, y, y + gridCols + gridRows, t);
  }
}

function drawObstacle(o, t) {
  const cx = o.x * CELL_SIZE + CELL_SIZE / 2;
  const cy = o.y * CELL_SIZE + CELL_SIZE / 2;
  const pulse = 0.5 + 0.5 * Math.sin(t * 4 + o.x * 0.7 + o.y * 0.7);

  const glowRadius = CELL_SIZE * 0.9 + pulse * 5;
  const gradient = ctx.createRadialGradient(cx, cy, 1, cx, cy, glowRadius);
  gradient.addColorStop(0, `rgba(255,45,170,${0.55 + 0.3 * pulse})`);
  gradient.addColorStop(1, 'rgba(255,45,170,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath();
  ctx.moveTo(cx, cy - CELL_SIZE * 0.45);
  ctx.lineTo(cx + CELL_SIZE * 0.42, cy - CELL_SIZE * 0.08);
  ctx.lineTo(cx + CELL_SIZE * 0.28, cy + CELL_SIZE * 0.45);
  ctx.lineTo(cx - CELL_SIZE * 0.28, cy + CELL_SIZE * 0.45);
  ctx.lineTo(cx - CELL_SIZE * 0.42, cy - CELL_SIZE * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(255,80,190,${0.7 + 0.3 * pulse})`;
  ctx.stroke();

  ctx.fillStyle = '#ffe14d';
  ctx.fillRect(cx - 1.5, cy - CELL_SIZE * 0.22, 3, CELL_SIZE * 0.28);
  ctx.beginPath();
  ctx.arc(cx, cy + CELL_SIZE * 0.16, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawEntities(state, t) {
  for (const o of state.obstacles) {
    drawObstacle(o, t);
  }

  ctx.fillStyle = '#f1fa8c';
  for (const f of state.food) {
    ctx.beginPath();
    ctx.arc(
      f.x * CELL_SIZE + CELL_SIZE / 2,
      f.y * CELL_SIZE + CELL_SIZE / 2,
      CELL_SIZE / 3,
      0, Math.PI * 2
    );
    ctx.fill();
  }

  for (const p of state.players) {
    if (!p.alive) continue;
    ctx.fillStyle = p.color;
    p.body.forEach((seg, i) => {
      const pad = i === 0 ? 1 : 2;
      ctx.fillRect(
        seg.x * CELL_SIZE + pad,
        seg.y * CELL_SIZE + pad,
        CELL_SIZE - pad * 2,
        CELL_SIZE - pad * 2
      );
    });

    const head = p.body[0];
    const tx = Math.min(canvas.width - 4, Math.max(4, head.x * CELL_SIZE + CELL_SIZE / 2));
    const ty = Math.max(12, head.y * CELL_SIZE - 6);
    ctx.font = 'bold 12px Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(p.nickname, tx, ty);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(p.nickname, tx, ty);
  }
}

function drawCountdownOverlay() {
  if (currentRoundState !== 'countdown' || countdownValue == null) return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f1fa8c';
  ctx.font = 'bold 120px Segoe UI, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(countdownValue), canvas.width / 2, canvas.height / 2);
  ctx.restore();
}

function frame(timestamp) {
  if (canvas.width && canvas.height) {
    const t = timestamp / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawLavaBorder(t);
    if (latestState) drawEntities(latestState, t);
    drawCountdownOverlay();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function renderScoreboard(state) {
  scoreboard.innerHTML = '';
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  for (const p of sorted) {
    const entry = document.createElement('div');
    entry.className = 'score-entry' + (p.alive ? '' : ' dead');
    const dot = document.createElement('span');
    dot.className = 'score-dot';
    dot.style.background = p.color;
    entry.appendChild(dot);
    const label = document.createElement('span');
    const you = p.id === myId ? ' (você)' : '';
    label.textContent = `${p.nickname}${you}: ${p.score}`;
    entry.appendChild(label);
    scoreboard.appendChild(entry);
  }
}

const KEY_TO_DIRECTION = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right'
};

window.addEventListener('keydown', e => {
  const dir = KEY_TO_DIRECTION[e.key];
  if (!dir) return;
  e.preventDefault();
  socket.emit('direction', dir);
});
