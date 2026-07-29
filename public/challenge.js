(function () {
  const challengeMenuScreen = document.getElementById('challenge-menu-screen');
  const challengeListEl = document.getElementById('challenge-list');
  const backFromChallengeMenuBtn = document.getElementById('back-from-challenge-menu-btn');

  const challengeScreen = document.getElementById('challenge-screen');
  const challengeHud = document.getElementById('challenge-hud');
  const challengeTitleEl = document.getElementById('challenge-title');
  const challengeProgressEl = document.getElementById('challenge-progress');
  const challengeTimerEl = document.getElementById('challenge-timer');
  const challengeQuitBtn = document.getElementById('challenge-quit-btn');
  const challengeCanvas = document.getElementById('challenge-canvas');
  const cctx = challengeCanvas.getContext('2d');

  const resultOverlay = document.getElementById('challenge-result-overlay');
  const resultTitleEl = document.getElementById('challenge-result-title');
  const resultDetailEl = document.getElementById('challenge-result-detail');
  const retryBtn = document.getElementById('challenge-retry-btn');
  const menuReturnBtn = document.getElementById('challenge-menu-return-btn');

  const CELL = 20;
  const COLS = 48;
  const ROWS = 32;
  const TICK_MS = 55; // intervalo entre passos da cobra em velocidade padrão (resposta às setas o mais rápida possível)
  const OBSTACLE_CAP = 20;
  const PRECOUNTDOWN_SECONDS = 3;
  const SPEED_RAMP_START_MS = 85; // intervalo do primeiro tick da corrida (início levemente mais devagar)
  const SPEED_RAMP_DURATION_MS = 700; // tempo até a velocidade chegar ao padrão — bem curto, só um "vai!" inicial
  const HUNTER_SKIP_EVERY = 5; // a caçadora fica parada 1 a cada 5 ticks, ficando um pouco mais lenta

  let CELL_W = CELL;
  let CELL_H = CELL;

  function computeChallengeCanvasSize() {
    const mobile = isMobileLayout();
    let targetW, targetH;
    if (mobile) {
      // no celular a arena estica para preencher quase toda a tela; as células deixam de ser quadradas
      const viewportW = challengeScreen.getBoundingClientRect().width || window.innerWidth;
      const viewportH = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      const hudHeight = challengeHud.getBoundingClientRect().height;
      const verticalReserve = 32; // gap entre HUD/canvas + margem de segurança
      targetW = Math.round(Math.max(120, viewportW));
      targetH = Math.round(Math.max(120, viewportH - hudHeight - verticalReserve));
    } else {
      targetW = COLS * CELL;
      targetH = ROWS * CELL;
    }

    CELL_W = targetW / COLS;
    CELL_H = targetH / ROWS;
    if (challengeCanvas.width === targetW && challengeCanvas.height === targetH) return;

    challengeCanvas.width = targetW;
    challengeCanvas.height = targetH;
    if (mobile) {
      challengeCanvas.style.width = `${targetW}px`;
      challengeCanvas.style.height = `${targetH}px`;
    } else {
      challengeCanvas.style.width = '';
      challengeCanvas.style.height = '';
    }
  }

  window.addEventListener('resize', computeChallengeCanvasSize);
  window.addEventListener('orientationchange', () => setTimeout(computeChallengeCanvasSize, 300));

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  const CHALLENGES = [
    {
      id: 'speed-eat',
      icon: '🍏',
      name: 'Fome Rápida',
      description: 'Coma 20 bolinhas antes que o tempo acabe.',
      duration: 45,
      type: 'eatFood',
      target: 20
    },
    {
      id: 'hunter-chase',
      icon: '🐍',
      name: 'Fuga da Caçadora',
      description: 'Sobreviva 60 segundos fugindo de uma cobra caçadora que te persegue.',
      duration: 60,
      type: 'survive',
      hasHunter: true
    },
    {
      id: 'checkpoint-rush',
      icon: '🚩',
      name: 'Corrida de Checkpoints',
      description: 'Alcance 8 checkpoints antes que o tempo acabe.',
      duration: 40,
      type: 'checkpoints',
      target: 8
    },
    {
      id: 'minefield',
      icon: '💣',
      name: 'Campo Minado',
      description: 'Coma 10 bolinhas enquanto obstáculos surgem sem parar.',
      duration: 35,
      type: 'eatFood',
      target: 10,
      fastObstacles: true
    }
  ];

  let snake = null;
  let hunter = null;
  let food = [];
  let obstacles = [];
  let checkpoint = null;
  let challenge = null;
  let progress = 0;
  let timeLeftMs = 0;
  let running = false;
  let tickTimer = null;
  let countdownTimer = null;
  let obstacleTimer = null;
  let precountdown = null;
  let precountdownTimer = null;
  let runStartTime = 0;
  let hunterTickCounter = 0;

  function isFree(x, y) {
    if (food.some(f => f.x === x && f.y === y)) return false;
    if (obstacles.some(o => o.x === x && o.y === y)) return false;
    if (checkpoint && checkpoint.x === x && checkpoint.y === y) return false;
    if (snake && snake.body.some(s => s.x === x && s.y === y)) return false;
    if (hunter && hunter.body.some(s => s.x === x && s.y === y)) return false;
    return true;
  }

  function randomEmptyCell(margin) {
    for (let i = 0; i < 300; i++) {
      const x = margin + Math.floor(Math.random() * (COLS - margin * 2));
      const y = margin + Math.floor(Math.random() * (ROWS - margin * 2));
      if (isFree(x, y)) return { x, y };
    }
    return { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
  }

  function spawnFoodPool(count) {
    while (food.length < count) food.push(randomEmptyCell(1));
  }

  function spawnObstacle() {
    if (obstacles.length >= OBSTACLE_CAP) return;
    obstacles.push(randomEmptyCell(2));
  }

  function spawnCheckpoint() {
    checkpoint = randomEmptyCell(3);
  }

  function hunterStep() {
    const head = hunter.body[0];
    const target = snake.body[0];
    const cur = hunter.dir;
    const opts = [DIRS.up, DIRS.down, DIRS.left, DIRS.right].filter(
      d => !(d.x === -cur.x && d.y === -cur.y)
    );
    let best = null;
    let bestDist = Infinity;
    for (const d of opts) {
      const nx = head.x + d.x, ny = head.y + d.y;
      if (nx <= 0 || nx >= COLS - 1 || ny <= 0 || ny >= ROWS - 1) continue;
      if (obstacles.some(o => o.x === nx && o.y === ny)) continue;
      if (hunter.body.slice(0, -1).some(s => s.x === nx && s.y === ny)) continue;
      const dist = Math.abs(nx - target.x) + Math.abs(ny - target.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    if (!best) best = cur;
    hunter.dir = best;
    const nh = { x: head.x + best.x, y: head.y + best.y };
    hunter.body.unshift(nh);
    hunter.body.pop();
  }

  function updateHud() {
    if (precountdown != null) {
      challengeTimerEl.textContent = `Começando em ${precountdown}...`;
      challengeTimerEl.classList.remove('low-time');
      challengeProgressEl.textContent = 'Prepare-se...';
      return;
    }
    const secs = Math.ceil(timeLeftMs / 1000);
    challengeTimerEl.textContent = `⏱ ${secs}s`;
    challengeTimerEl.classList.toggle('low-time', secs <= 10);
    if (challenge.type === 'eatFood') {
      challengeProgressEl.textContent = `🍏 ${progress}/${challenge.target}`;
    } else if (challenge.type === 'checkpoints') {
      challengeProgressEl.textContent = `🚩 ${progress}/${challenge.target}`;
    } else {
      challengeProgressEl.textContent = '🏃 Sobrevivendo...';
    }
  }

  function stopTimers() {
    running = false;
    clearTimeout(tickTimer);
    clearInterval(countdownTimer);
    clearInterval(obstacleTimer);
    clearInterval(precountdownTimer);
    precountdown = null;
  }

  function elapsedMs() {
    return challenge.duration * 1000 - timeLeftMs;
  }

  function loadBest(id) {
    try {
      return JSON.parse(localStorage.getItem('snakeChallengeBest_' + id)) || { completed: false, bestMs: null };
    } catch (e) {
      return { completed: false, bestMs: null };
    }
  }

  function saveBest(id, elapsed) {
    const cur = loadBest(id);
    const bestMs = cur.bestMs == null ? elapsed : Math.min(cur.bestMs, elapsed);
    localStorage.setItem('snakeChallengeBest_' + id, JSON.stringify({ completed: true, bestMs }));
  }

  function showResult(success, title, detail) {
    resultTitleEl.textContent = title;
    resultTitleEl.style.color = success ? '#50fa7b' : '#ff5555';
    resultDetailEl.textContent = detail;
    resultOverlay.classList.remove('hidden');
  }

  function fail(reason) {
    stopTimers();
    showResult(false, 'Desafio falhou', reason);
  }

  function succeed() {
    stopTimers();
    const elapsed = elapsedMs();
    saveBest(challenge.id, elapsed);
    const detail = challenge.type === 'survive'
      ? 'Você sobreviveu o tempo todo!'
      : `Concluído em ${(elapsed / 1000).toFixed(1)}s.`;
    showResult(true, '🎉 Desafio completo!', detail);
  }

  function tick() {
    if (!running) return;
    snake.dir = snake.pendingDir;
    const head = snake.body[0];
    const nh = { x: head.x + snake.dir.x, y: head.y + snake.dir.y };

    if (nh.x <= 0 || nh.x >= COLS - 1 || nh.y <= 0 || nh.y >= ROWS - 1) {
      fail('Você bateu na borda!');
      return;
    }
    if (obstacles.some(o => o.x === nh.x && o.y === nh.y)) {
      fail('Você bateu em um obstáculo!');
      return;
    }
    if (snake.body.slice(0, -1).some(s => s.x === nh.x && s.y === nh.y)) {
      fail('Você bateu em si mesmo!');
      return;
    }

    if (hunter) {
      hunterTickCounter += 1;
      if (hunterTickCounter % HUNTER_SKIP_EVERY !== 0) {
        hunterStep();
      }
      if (hunter.body.some(s => s.x === nh.x && s.y === nh.y)) {
        fail('A caçadora te pegou!');
        return;
      }
    }

    snake.body.unshift(nh);
    let grew = false;

    if (challenge.type === 'eatFood') {
      const idx = food.findIndex(f => f.x === nh.x && f.y === nh.y);
      if (idx !== -1) {
        food.splice(idx, 1);
        progress += 1;
        grew = true;
        spawnFoodPool(8);
        updateHud();
        if (progress >= challenge.target) {
          succeed();
          return;
        }
      }
    } else if (challenge.type === 'checkpoints') {
      if (checkpoint && checkpoint.x === nh.x && checkpoint.y === nh.y) {
        progress += 1;
        grew = true;
        updateHud();
        if (progress >= challenge.target) {
          succeed();
          return;
        }
        spawnCheckpoint();
      }
    }

    if (!grew) snake.body.pop();
  }

  function countdownStep() {
    if (!running) return;
    timeLeftMs -= 100;
    if (timeLeftMs <= 0) {
      timeLeftMs = 0;
      updateHud();
      if (challenge.type === 'survive') {
        succeed();
      } else {
        fail('Tempo esgotado!');
      }
      return;
    }
    updateHud();
  }

  function startChallenge(id) {
    challenge = CHALLENGES.find(c => c.id === id);
    if (!challenge) return;

    food = [];
    obstacles = [];
    checkpoint = null;
    hunter = null;
    snake = null;
    progress = 0;

    const dirKeys = Object.keys(DIRS);
    const startDir = DIRS[dirKeys[Math.floor(Math.random() * dirKeys.length)]];
    const startCell = randomEmptyCell(10);
    snake = { body: [startCell], dir: startDir, pendingDir: startDir };

    if (challenge.hasHunter) {
      const hDir = DIRS[dirKeys[Math.floor(Math.random() * dirKeys.length)]];
      const hHead = randomEmptyCell(7);
      const hBody = [];
      for (let i = 0; i < 6; i++) {
        hBody.push({ x: hHead.x - hDir.x * i, y: hHead.y - hDir.y * i });
      }
      hunter = { body: hBody, dir: hDir };
    }

    if (challenge.type === 'eatFood') spawnFoodPool(8);
    if (challenge.type === 'checkpoints') spawnCheckpoint();

    for (let i = 0; i < 4; i++) spawnObstacle();

    timeLeftMs = challenge.duration * 1000;
    running = false;
    hunterTickCounter = 0;

    challengeTitleEl.textContent = `${challenge.icon} ${challenge.name}`;
    resultOverlay.classList.add('hidden');

    clearTimeout(tickTimer);
    clearInterval(countdownTimer);
    clearInterval(obstacleTimer);
    clearInterval(precountdownTimer);

    challengeScreen.classList.remove('hidden');
    activeMode = 'challenge';
    // define o texto mais longo do HUD ("Começando em X...") antes de medir a altura dele,
    // para reservar espaço suficiente e a arena não ultrapassar a tela
    beginPrecountdown();
    computeChallengeCanvasSize();
  }

  function beginPrecountdown() {
    // mostra a cobra (e a caçadora, se houver) já posicionadas no mapa antes de começar a mover
    precountdown = PRECOUNTDOWN_SECONDS;
    updateHud();
    clearInterval(precountdownTimer);
    precountdownTimer = setInterval(() => {
      precountdown -= 1;
      if (precountdown <= 0) {
        clearInterval(precountdownTimer);
        precountdown = null;
        beginRun();
      } else {
        updateHud();
      }
    }, 1000);
  }

  function currentTickDelay() {
    if (!running) return TICK_MS;
    const elapsed = Date.now() - runStartTime;
    if (elapsed >= SPEED_RAMP_DURATION_MS) return TICK_MS;
    const t = elapsed / SPEED_RAMP_DURATION_MS;
    return SPEED_RAMP_START_MS + (TICK_MS - SPEED_RAMP_START_MS) * t;
  }

  function scheduleTick() {
    tickTimer = setTimeout(() => {
      tick();
      if (running) scheduleTick();
    }, currentTickDelay());
  }

  function beginRun() {
    running = true;
    runStartTime = Date.now();
    updateHud();
    clearTimeout(tickTimer);
    clearInterval(countdownTimer);
    clearInterval(obstacleTimer);
    scheduleTick();
    countdownTimer = setInterval(countdownStep, 100);
    if (challenge.fastObstacles) {
      obstacleTimer = setInterval(() => {
        if (running) spawnObstacle();
      }, 1200);
    }
  }

  function renderChallengeMenu() {
    challengeListEl.innerHTML = '';
    for (const c of CHALLENGES) {
      const best = loadBest(c.id);
      const card = document.createElement('div');
      card.className = 'challenge-card';

      const icon = document.createElement('div');
      icon.className = 'challenge-card-icon';
      icon.textContent = c.icon;

      const body = document.createElement('div');
      body.className = 'challenge-card-body';

      const name = document.createElement('div');
      name.className = 'challenge-card-name';
      name.textContent = c.name;

      const desc = document.createElement('div');
      desc.className = 'challenge-card-desc';
      desc.textContent = c.description;

      const meta = document.createElement('div');
      meta.className = 'challenge-card-meta';
      let metaText = `⏱ ${c.duration}s`;
      if (best.completed) {
        metaText += c.type === 'survive' ? ' · Completo ✅' : ` · Recorde: ${(best.bestMs / 1000).toFixed(1)}s`;
      } else {
        metaText += ' · Ainda não completado';
      }
      meta.textContent = metaText;

      body.appendChild(name);
      body.appendChild(desc);
      body.appendChild(meta);

      const playBtn = document.createElement('button');
      playBtn.className = 'challenge-card-play';
      playBtn.type = 'button';
      playBtn.textContent = 'Jogar';
      playBtn.addEventListener('click', () => {
        challengeMenuScreen.classList.add('hidden');
        startChallenge(c.id);
      });

      card.appendChild(icon);
      card.appendChild(body);
      card.appendChild(playBtn);
      challengeListEl.appendChild(card);
    }
  }

  window.showChallengeMenu = function () {
    renderChallengeMenu();
    challengeMenuScreen.classList.remove('hidden');
  };

  backFromChallengeMenuBtn.addEventListener('click', () => {
    challengeMenuScreen.classList.add('hidden');
    modeSelectScreen.classList.remove('hidden');
  });

  challengeQuitBtn.addEventListener('click', () => {
    stopTimers();
    activeMode = 'none';
    challengeScreen.classList.add('hidden');
    resultOverlay.classList.add('hidden');
    window.showChallengeMenu();
  });

  retryBtn.addEventListener('click', () => {
    resultOverlay.classList.add('hidden');
    startChallenge(challenge.id);
  });

  menuReturnBtn.addEventListener('click', () => {
    activeMode = 'none';
    challengeScreen.classList.add('hidden');
    window.showChallengeMenu();
  });

  function trySetDirection(dirName) {
    if (activeMode !== 'challenge' || !running || !snake) return;
    const nd = DIRS[dirName];
    if (!nd) return;
    if (nd.x === -snake.dir.x && nd.y === -snake.dir.y) return;
    snake.pendingDir = nd;
  }

  window.addEventListener('keydown', e => {
    if (activeMode !== 'challenge') return;
    if (e.key === 'Enter' && !resultOverlay.classList.contains('hidden')) {
      e.preventDefault();
      retryBtn.click();
      return;
    }
    const dirName = KEY_TO_DIRECTION[e.key];
    if (!dirName) return;
    e.preventDefault();
    trySetDirection(dirName);
  });

  attachSwipeControls(challengeCanvas, trySetDirection);

  function lerp(a, b, t) {
    return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
  }

  const STARS = Array.from({ length: 140 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: 0.4 + Math.random() * 1.3,
    phase: Math.random() * Math.PI * 2
  }));

  function drawBackground(t) {
    const w = challengeCanvas.width, h = challengeCanvas.height;
    const base = cctx.createRadialGradient(w * 0.3, h * 0.32, 0, w * 0.3, h * 0.32, w * 0.9);
    base.addColorStop(0, '#241a3d');
    base.addColorStop(0.5, '#120e22');
    base.addColorStop(1, '#08070f');
    cctx.fillStyle = base;
    cctx.fillRect(0, 0, w, h);

    const neb = cctx.createRadialGradient(w * 0.72, h * 0.68, 0, w * 0.72, h * 0.68, w * 0.5);
    neb.addColorStop(0, 'rgba(74,217,201,0.14)');
    neb.addColorStop(1, 'rgba(74,217,201,0)');
    cctx.fillStyle = neb;
    cctx.fillRect(0, 0, w, h);

    STARS.forEach(s => {
      const tw = 0.5 + 0.5 * Math.sin(t * 1.6 + s.phase);
      cctx.fillStyle = `rgba(255,255,255,${0.25 + 0.6 * tw})`;
      cctx.beginPath();
      cctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      cctx.fill();
    });
  }

  const AURORA_DARK = [70, 40, 130];
  const AURORA_BRIGHT = [90, 230, 210];

  function drawAuroraCell(gx, gy, seed, t) {
    const intensity = 0.5 + 0.5 * Math.sin(t * 1.8 + seed * 0.5);
    const [r, g, b] = lerp(AURORA_DARK, AURORA_BRIGHT, intensity);
    const padX = CELL_W * 0.15;
    const padY = CELL_H * 0.15;
    cctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
    cctx.fillRect(gx * CELL_W, gy * CELL_H, CELL_W, CELL_H);
    cctx.fillStyle = `rgba(150,120,255,${0.28 * intensity})`;
    cctx.fillRect(gx * CELL_W - padX, gy * CELL_H - padY, CELL_W + padX * 2, CELL_H + padY * 2);
  }

  function drawBorder(t) {
    for (let x = 0; x < COLS; x++) {
      drawAuroraCell(x, 0, x, t);
      drawAuroraCell(x, ROWS - 1, x + ROWS, t);
    }
    for (let y = 1; y < ROWS - 1; y++) {
      drawAuroraCell(0, y, y + COLS, t);
      drawAuroraCell(COLS - 1, y, y + COLS + ROWS, t);
    }
  }

  function drawObstacleShape(o, t) {
    const cs = Math.min(CELL_W, CELL_H);
    const cx = o.x * CELL_W + CELL_W / 2, cy = o.y * CELL_H + CELL_H / 2;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4 + o.x * 0.7 + o.y * 0.7);
    const glowR = cs * 0.9 + pulse * 5;
    const grad = cctx.createRadialGradient(cx, cy, 1, cx, cy, glowR);
    grad.addColorStop(0, `rgba(255,45,170,${0.55 + 0.3 * pulse})`);
    grad.addColorStop(1, 'rgba(255,45,170,0)');
    cctx.fillStyle = grad;
    cctx.beginPath();
    cctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    cctx.fill();

    cctx.fillStyle = '#2b2b2b';
    cctx.beginPath();
    cctx.moveTo(cx, cy - cs * 0.45);
    cctx.lineTo(cx + cs * 0.42, cy - cs * 0.08);
    cctx.lineTo(cx + cs * 0.28, cy + cs * 0.45);
    cctx.lineTo(cx - cs * 0.28, cy + cs * 0.45);
    cctx.lineTo(cx - cs * 0.42, cy - cs * 0.08);
    cctx.closePath();
    cctx.fill();
    cctx.lineWidth = 2;
    cctx.strokeStyle = `rgba(255,80,190,${0.7 + 0.3 * pulse})`;
    cctx.stroke();
  }

  function drawFood() {
    const cs = Math.min(CELL_W, CELL_H);
    cctx.fillStyle = '#f1fa8c';
    for (const f of food) {
      cctx.beginPath();
      cctx.arc(f.x * CELL_W + CELL_W / 2, f.y * CELL_H + CELL_H / 2, cs / 3, 0, Math.PI * 2);
      cctx.fill();
    }
  }

  function drawCheckpoint(t) {
    if (!checkpoint) return;
    const cs = Math.min(CELL_W, CELL_H);
    const cx = checkpoint.x * CELL_W + CELL_W / 2, cy = checkpoint.y * CELL_H + CELL_H / 2;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    cctx.strokeStyle = `rgba(80,250,180,${0.6 + 0.35 * pulse})`;
    cctx.lineWidth = 3;
    cctx.beginPath();
    cctx.arc(cx, cy, cs * 0.35 + pulse * 3, 0, Math.PI * 2);
    cctx.stroke();
    cctx.fillStyle = '#50fab4';
    cctx.beginPath();
    cctx.moveTo(cx - 2, cy - cs * 0.3);
    cctx.lineTo(cx - 2, cy + cs * 0.3);
    cctx.lineTo(cx + cs * 0.28, cy - cs * 0.12);
    cctx.closePath();
    cctx.fill();
  }

  function drawSnakeBody(body, color) {
    body.forEach((seg, i) => {
      const pad = i === 0 ? 1 : 2;
      cctx.fillStyle = color;
      cctx.fillRect(seg.x * CELL_W + pad, seg.y * CELL_H + pad, CELL_W - pad * 2, CELL_H - pad * 2);
    });
  }

  function drawEyes(head, dir) {
    const cx = head.x * CELL_W + CELL_W / 2;
    const cy = head.y * CELL_H + CELL_H / 2;
    const perpX = -dir.y;
    const perpY = dir.x;
    const eyeR = Math.min(CELL_W, CELL_H) * 0.12;
    cctx.fillStyle = '#0b0b12';
    for (const side of [-1, 1]) {
      const ex = cx + dir.x * CELL_W * 0.16 + perpX * CELL_W * 0.22 * side;
      const ey = cy + dir.y * CELL_H * 0.16 + perpY * CELL_H * 0.22 * side;
      cctx.beginPath();
      cctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      cctx.fill();
    }
  }

  function drawHunter(t) {
    if (!hunter) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    cctx.fillStyle = `rgba(255,50,50,${0.3 + 0.25 * pulse})`;
    hunter.body.forEach(seg => {
      cctx.fillRect(seg.x * CELL_W - 2, seg.y * CELL_H - 2, CELL_W + 4, CELL_H + 4);
    });
    drawSnakeBody(hunter.body, '#d62828');
    drawEyes(hunter.body[0], hunter.dir);
  }

  function drawPrecountdownOverlay() {
    if (precountdown == null) return;
    cctx.save();
    cctx.fillStyle = 'rgba(0,0,0,0.45)';
    cctx.fillRect(0, 0, challengeCanvas.width, challengeCanvas.height);
    cctx.fillStyle = '#f1fa8c';
    cctx.font = 'bold 100px Segoe UI, Arial, sans-serif';
    cctx.textAlign = 'center';
    cctx.textBaseline = 'middle';
    cctx.fillText(String(precountdown), challengeCanvas.width / 2, challengeCanvas.height / 2);
    cctx.restore();
  }

  function render(t) {
    if (!challengeCanvas.width || !challengeCanvas.height) return;
    drawBackground(t);
    drawBorder(t);
    for (const o of obstacles) drawObstacleShape(o, t);
    drawFood();
    drawCheckpoint(t);
    drawHunter(t);
    if (snake) {
      drawSnakeBody(snake.body, '#50fa7b');
      drawEyes(snake.body[0], snake.pendingDir);
    }
    drawPrecountdownOverlay();
  }

  function frame(ts) {
    if (activeMode === 'challenge') render(ts / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
