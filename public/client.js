const CELL_SIZE = 20; // tamanho de célula padrão no desktop (células quadradas)
const MOBILE_BREAKPOINT = 480;
let CELL_W = CELL_SIZE;
let CELL_H = CELL_SIZE;

function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

let activeMode = 'none'; // none | multiplayer | challenge — usado para rotear o teclado

const modeSelectScreen = document.getElementById('mode-select-screen');
const chooseMultiplayerBtn = document.getElementById('choose-multiplayer-btn');
const chooseChallengeBtn = document.getElementById('choose-challenge-btn');
const backFromJoinBtn = document.getElementById('back-from-join-btn');

const joinScreen = document.getElementById('join-screen');
const joinForm = document.getElementById('join-form');
const nicknameInput = document.getElementById('nickname-input');
const joinError = document.getElementById('join-error');

chooseMultiplayerBtn.addEventListener('click', () => {
  modeSelectScreen.classList.add('hidden');
  joinScreen.classList.remove('hidden');
});

backFromJoinBtn.addEventListener('click', () => {
  joinScreen.classList.add('hidden');
  modeSelectScreen.classList.remove('hidden');
});

chooseChallengeBtn.addEventListener('click', () => {
  modeSelectScreen.classList.add('hidden');
  window.showChallengeMenu();
});

const gameScreen = document.getElementById('game-screen');
const hud = document.getElementById('hud');
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreboard = document.getElementById('scoreboard');
const roundMessage = document.getElementById('round-message');
const modeIndicator = document.getElementById('mode-indicator');
const hostControls = document.getElementById('host-controls');
const startBtn = document.getElementById('start-btn');
const modeClassicBtn = document.getElementById('mode-classic-btn');
const modeSurvivalBtn = document.getElementById('mode-survival-btn');

const socket = io({ transports: ['websocket'] });
let myId = null;
let gridCols = 0;
let gridRows = 0;
let latestState = null;
let currentRoundState = 'waiting';
let countdownValue = null;
let hostId = null;
let waitingNeeded = null;
let gameMode = 'classic';
let winScore = 100;

startBtn.addEventListener('click', () => {
  socket.emit('startGame');
});

modeClassicBtn.addEventListener('click', () => {
  socket.emit('setMode', { mode: 'classic' });
});

modeSurvivalBtn.addEventListener('click', () => {
  socket.emit('setMode', { mode: 'survival' });
});

function updateHostControls() {
  const isHost = myId != null && hostId === myId;

  modeIndicator.textContent = (gameMode === 'survival'
    ? '🛡️ Sobrevivência — só vencer a rodada pontua'
    : '🍏 Clássico — comer pontua') + ` · 🏆 Primeiro a ${winScore} pts vence a partida!`;

  const showControls = isHost && (currentRoundState === 'waiting' || currentRoundState === 'matchEnd');
  if (!showControls) {
    hostControls.classList.add('hidden');
    return;
  }
  hostControls.classList.remove('hidden');
  modeClassicBtn.classList.toggle('active', gameMode === 'classic');
  modeSurvivalBtn.classList.toggle('active', gameMode === 'survival');

  if (currentRoundState === 'matchEnd') {
    startBtn.disabled = false;
    startBtn.textContent = 'Nova partida';
    return;
  }

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

function computeCanvasSize() {
  if (!gridCols || !gridRows) return;
  const mobile = isMobileLayout();
  let targetW, targetH;
  if (mobile) {
    // no celular a arena estica para preencher quase toda a tela; as células deixam de ser quadradas
    const viewportW = gameScreen.getBoundingClientRect().width || window.innerWidth;
    const viewportH = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const hudHeight = hud.getBoundingClientRect().height;
    const verticalReserve = 32; // gap entre HUD/canvas + margem de segurança
    targetW = Math.round(Math.max(120, viewportW));
    targetH = Math.round(Math.max(120, viewportH - hudHeight - verticalReserve));
  } else {
    targetW = gridCols * CELL_SIZE;
    targetH = gridRows * CELL_SIZE;
  }

  CELL_W = targetW / gridCols;
  CELL_H = targetH / gridRows;
  if (canvas.width === targetW && canvas.height === targetH) return;

  canvas.width = targetW;
  canvas.height = targetH;
  if (mobile) {
    canvas.style.width = `${targetW}px`;
    canvas.style.height = `${targetH}px`;
  } else {
    canvas.style.width = '';
    canvas.style.height = '';
  }
}

window.addEventListener('resize', computeCanvasSize);
window.addEventListener('orientationchange', () => setTimeout(computeCanvasSize, 300));

socket.on('joined', ({ id, grid }) => {
  myId = id;
  gridCols = grid.cols;
  gridRows = grid.rows;
  joinScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  activeMode = 'multiplayer';
  computeCanvasSize();
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
      localPendingDir = null;
      roundMessage.textContent = `Começando em ${event.seconds}...`;
      break;
    case 'start':
      countdownValue = null;
      localPendingDir = null;
      roundMessage.textContent = 'Vale tudo!';
      break;
    case 'end':
      countdownValue = null;
      roundMessage.textContent = event.winner
        ? `🏆 ${event.winner} venceu a rodada!`
        : 'Empate! Ninguém sobreviveu.';
      break;
    case 'matchEnd':
      countdownValue = null;
      roundMessage.textContent = `🏆🎉 ${event.winner} venceu a PARTIDA com ${event.score} pontos!`;
      break;
  }
  updateHostControls();
  computeCanvasSize();
});

let lastScoreboardCount = -1;

socket.on('state', state => {
  latestState = state;
  hostId = state.hostId;
  gameMode = state.gameMode;
  winScore = state.winScore || winScore;
  renderScoreboard(state);
  updateHostControls();
  if (state.players.length !== lastScoreboardCount) {
    lastScoreboardCount = state.players.length;
    computeCanvasSize();
  }
});

function lerpColor(a, b, t) {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
}

const STARS = Array.from({ length: 220 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: 0.4 + Math.random() * 1.3,
  phase: Math.random() * Math.PI * 2
}));

function drawCosmicBackground(t) {
  const w = canvas.width, h = canvas.height;

  const base = ctx.createRadialGradient(w * 0.3, h * 0.32, 0, w * 0.3, h * 0.32, w * 0.9);
  base.addColorStop(0, '#241a3d');
  base.addColorStop(0.5, '#120e22');
  base.addColorStop(1, '#08070f');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const nebA = ctx.createRadialGradient(w * 0.72, h * 0.68, 0, w * 0.72, h * 0.68, w * 0.5);
  nebA.addColorStop(0, 'rgba(74,217,201,0.14)');
  nebA.addColorStop(1, 'rgba(74,217,201,0)');
  ctx.fillStyle = nebA;
  ctx.fillRect(0, 0, w, h);

  const nebB = ctx.createRadialGradient(w * 0.22, h * 0.78, 0, w * 0.22, h * 0.78, w * 0.45);
  nebB.addColorStop(0, 'rgba(176,131,255,0.12)');
  nebB.addColorStop(1, 'rgba(176,131,255,0)');
  ctx.fillStyle = nebB;
  ctx.fillRect(0, 0, w, h);

  STARS.forEach(s => {
    const tw = 0.5 + 0.5 * Math.sin(t * 1.6 + s.phase);
    ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.6 * tw})`;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
    ctx.fill();
  });
}

const AURORA_DARK = [70, 40, 130];
const AURORA_BRIGHT = [90, 230, 210];

function drawAuroraCell(gx, gy, seed, t) {
  const intensity = 0.5 + 0.5 * Math.sin(t * 1.8 + seed * 0.5);
  const [r, g, b] = lerpColor(AURORA_DARK, AURORA_BRIGHT, intensity);
  const padX = CELL_W * 0.15;
  const padY = CELL_H * 0.15;
  ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
  ctx.fillRect(gx * CELL_W, gy * CELL_H, CELL_W, CELL_H);
  ctx.fillStyle = `rgba(150,120,255,${0.28 * intensity})`;
  ctx.fillRect(gx * CELL_W - padX, gy * CELL_H - padY, CELL_W + padX * 2, CELL_H + padY * 2);
}

function drawAuroraBorder(t) {
  if (!gridCols || !gridRows) return;
  for (let x = 0; x < gridCols; x++) {
    drawAuroraCell(x, 0, x, t);
    drawAuroraCell(x, gridRows - 1, x + gridRows, t);
  }
  for (let y = 1; y < gridRows - 1; y++) {
    drawAuroraCell(0, y, y + gridCols, t);
    drawAuroraCell(gridCols - 1, y, y + gridCols + gridRows, t);
  }
}

function drawObstacle(o, t) {
  const cs = Math.min(CELL_W, CELL_H);
  const cx = o.x * CELL_W + CELL_W / 2;
  const cy = o.y * CELL_H + CELL_H / 2;
  const pulse = 0.5 + 0.5 * Math.sin(t * 4 + o.x * 0.7 + o.y * 0.7);

  const glowRadius = cs * 0.9 + pulse * 5;
  const gradient = ctx.createRadialGradient(cx, cy, 1, cx, cy, glowRadius);
  gradient.addColorStop(0, `rgba(255,45,170,${0.55 + 0.3 * pulse})`);
  gradient.addColorStop(1, 'rgba(255,45,170,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath();
  ctx.moveTo(cx, cy - cs * 0.45);
  ctx.lineTo(cx + cs * 0.42, cy - cs * 0.08);
  ctx.lineTo(cx + cs * 0.28, cy + cs * 0.45);
  ctx.lineTo(cx - cs * 0.28, cy + cs * 0.45);
  ctx.lineTo(cx - cs * 0.42, cy - cs * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(255,80,190,${0.7 + 0.3 * pulse})`;
  ctx.stroke();

  ctx.fillStyle = '#ffe14d';
  ctx.fillRect(cx - 1.5, cy - cs * 0.22, 3, cs * 0.28);
  ctx.beginPath();
  ctx.arc(cx, cy + cs * 0.16, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawGem(gem, t) {
  const cs = Math.min(CELL_W, CELL_H);
  const cx = gem.x * CELL_W + CELL_W / 2;
  const cy = gem.y * CELL_H + CELL_H / 2;
  const pulse = 0.5 + 0.5 * Math.sin(t * 5);

  const glowRadius = cs * 0.9 + pulse * 4;
  const gradient = ctx.createRadialGradient(cx, cy, 1, cx, cy, glowRadius);
  gradient.addColorStop(0, `rgba(255,255,255,${0.5 + 0.3 * pulse})`);
  gradient.addColorStop(0.4, `rgba(0,225,255,${0.55 + 0.2 * pulse})`);
  gradient.addColorStop(1, 'rgba(0,225,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  const outerR = cs * 0.42;
  const innerR = outerR * 0.42;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(t * 1.2) * 0.2);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const outerAngle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const innerAngle = outerAngle + Math.PI / 5;
    ctx.lineTo(Math.cos(outerAngle) * outerR, Math.sin(outerAngle) * outerR);
    ctx.lineTo(Math.cos(innerAngle) * innerR, Math.sin(innerAngle) * innerR);
  }
  ctx.closePath();
  ctx.fillStyle = '#00e0ff';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawEntities(state, t) {
  for (const o of state.obstacles) {
    drawObstacle(o, t);
  }

  const cs = Math.min(CELL_W, CELL_H);
  ctx.fillStyle = '#f1fa8c';
  for (const f of state.food) {
    ctx.beginPath();
    ctx.arc(
      f.x * CELL_W + CELL_W / 2,
      f.y * CELL_H + CELL_H / 2,
      cs / 3,
      0, Math.PI * 2
    );
    ctx.fill();
  }

  if (state.gem) drawGem(state.gem, t);

  for (const p of state.players) {
    if (!p.alive) continue;

    if (p.invincible) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 8);
      ctx.fillStyle = `rgba(255,215,60,${0.35 + 0.25 * pulse})`;
      p.body.forEach(seg => {
        ctx.fillRect(
          seg.x * CELL_W - 2,
          seg.y * CELL_H - 2,
          CELL_W + 4,
          CELL_H + 4
        );
      });
    }

    ctx.fillStyle = p.color;
    p.body.forEach((seg, i) => {
      const pad = i === 0 ? 1 : 2;
      ctx.fillRect(
        seg.x * CELL_W + pad,
        seg.y * CELL_H + pad,
        CELL_W - pad * 2,
        CELL_H - pad * 2
      );
    });

    drawEyes(p.body[0], getFacingDir(p));

    const head = p.body[0];
    const tx = Math.min(canvas.width - 4, Math.max(4, head.x * CELL_W + CELL_W / 2));
    const ty = Math.max(12, head.y * CELL_H - 6);
    const label = p.invincible ? `🛡 ${p.nickname}` : p.nickname;
    ctx.font = 'bold 12px Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(label, tx, ty);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, tx, ty);
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
    drawCosmicBackground(t);
    drawAuroraBorder(t);
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
    label.textContent = `${p.nickname}${you}: ${p.score}/${winScore}`;
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

const DIRECTION_VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

// direção que o jogador acabou de pedir, aplicada instantaneamente nos "olhos"
// da própria cobra antes mesmo do servidor confirmar o movimento
let localPendingDir = null;

function getActualDir(player) {
  if (!player || player.body.length < 2) return null;
  const [head, neck] = player.body;
  return { x: Math.sign(head.x - neck.x), y: Math.sign(head.y - neck.y) };
}

function sendDirection(dirName) {
  const vec = DIRECTION_VECTORS[dirName];
  if (!vec) return;
  const myPlayer = latestState && latestState.players.find(p => p.id === myId);
  const actual = myPlayer ? getActualDir(myPlayer) : null;
  if (actual && vec.x === -actual.x && vec.y === -actual.y) return; // impede reverter, igual ao servidor
  localPendingDir = vec;
  socket.emit('direction', dirName);
}

function getFacingDir(player) {
  if (player.id === myId && localPendingDir) return localPendingDir;
  return getActualDir(player) || { x: 1, y: 0 };
}

function drawEyes(head, dir) {
  const cx = head.x * CELL_W + CELL_W / 2;
  const cy = head.y * CELL_H + CELL_H / 2;
  const perpX = -dir.y;
  const perpY = dir.x;
  const eyeR = Math.min(CELL_W, CELL_H) * 0.12;
  ctx.fillStyle = '#0b0b12';
  for (const side of [-1, 1]) {
    const ex = cx + dir.x * CELL_W * 0.16 + perpX * CELL_W * 0.22 * side;
    const ey = cy + dir.y * CELL_H * 0.16 + perpY * CELL_H * 0.22 * side;
    ctx.beginPath();
    ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
    ctx.fill();
  }
}

window.addEventListener('keydown', e => {
  if (activeMode !== 'multiplayer') return;
  const dir = KEY_TO_DIRECTION[e.key];
  if (!dir) return;
  e.preventDefault();
  sendDirection(dir);
});

function attachSwipeControls(element, onDirection) {
  const SWIPE_THRESHOLD = 24;
  let startX = 0;
  let startY = 0;

  element.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  element.addEventListener('touchmove', e => {
    if (e.touches.length === 1) e.preventDefault();
  }, { passive: false });

  element.addEventListener('touchend', e => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;
    const dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    onDirection(dir);
  }, { passive: true });
}

attachSwipeControls(canvas, dir => {
  if (activeMode !== 'multiplayer') return;
  sendDirection(dir);
});
