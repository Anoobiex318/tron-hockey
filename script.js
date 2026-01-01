const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game State
const state = {
    running: false,
    paused: false,
    mode: 'cpu', // 'cpu', 'local', 'online_host', 'online_client'
    difficulty: 'medium',
    flipped: undefined,
    p1: { score: 0, x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, radius: 0, color: '#00f2ff' },
    p2: { score: 0, x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, radius: 0, color: '#ff0066' },
    puck: { x: 0, y: 0, vx: 0, vy: 0, radius: 0, speed: 0, maxSpeed: 0 },
    field: { width: 400, height: 800 },
    particles: [],
    countdown: false,
    turn: 1,
    awaitingServe: false
};

const CONFIG = {
    friction: 0.992,
    wallBounce: 0.9,
    puckMaxSpeedMultiplier: 0.04,
    paddleRadiusRatio: 0.08,
    puckRadiusRatio: 0.04,
    winningScore: 12
};

const DIFFICULTIES = {
    medium: { speed: 0.1, reaction: 0.1, error: 20 },
    difficult: { speed: 0.18, reaction: 0.05, error: 10 },
    insane: { speed: 0.4, reaction: 0.01, error: 0 }
};

const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'hit') {
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'wall') {
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'score') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.setValueAtTime(800, now + 0.1);
        osc.frequency.setValueAtTime(400, now + 0.2);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        osc.start(now); osc.stop(now + 0.6);
    } else if (type === 'countdown') {
        osc.frequency.setValueAtTime(440, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);
    } else if (type === 'go') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
    }
}

// Coordinate Helpers
function viewX(lx) {
    const scale = canvas.width / state.field.width;
    const x = lx * scale;
    return state.flipped ? canvas.width - x : x;
}
function viewY(ly) {
    const scale = canvas.height / state.field.height;
    const y = ly * scale;
    return state.flipped ? canvas.height - y : y;
}
function viewLen(l) {
    return l * (canvas.width / state.field.width);
}
function logicX(px) {
    const scale = canvas.width / state.field.width;
    let x = px;
    if (state.flipped) x = canvas.width - x;
    return x / scale;
}
function logicY(py) {
    const scale = canvas.height / state.field.height;
    let y = py;
    if (state.flipped) y = canvas.height - y;
    return y / scale;
}

// Resize logic
function resize() {
    const container = document.getElementById('game-container');
    if (!container) return;
    canvas.width = container.clientWidth || window.innerWidth;
    canvas.height = container.clientHeight || window.innerHeight;

    const base = 400;
    state.p1.radius = base * CONFIG.paddleRadiusRatio;
    state.p2.radius = base * CONFIG.paddleRadiusRatio;
    state.puck.radius = base * CONFIG.puckRadiusRatio;
    state.puck.maxSpeed = 800 * CONFIG.puckMaxSpeedMultiplier;

    if (!state.running) resetPositions();
}

function resetPositions() {
    state.p1.x = state.field.width / 2;
    state.p1.y = state.field.height - state.field.height * 0.15;
    state.p1.prevX = state.p1.x; state.p1.prevY = state.p1.y;
    state.p2.x = state.field.width / 2;
    state.p2.y = state.field.height * 0.15;
    state.p2.prevX = state.p2.x; state.p2.prevY = state.p2.y;

    state.puck.vx = 0; state.puck.vy = 0;
    if (state.turn === 1) {
        state.puck.x = state.p1.x;
        state.puck.y = state.p1.y - state.p1.radius - state.puck.radius - 8;
    } else {
        state.puck.x = state.p2.x;
        state.puck.y = state.p2.y + state.p2.radius + state.puck.radius + 8;
    }
    state.awaitingServe = true;
    updateTurnUI();
}

function updateTurnUI() {
    const el = document.getElementById('turn-indicator');
    if (!el) return;
    if (!state.awaitingServe) { el.classList.add('hidden'); return; }

    el.textContent = `PLAYER ${state.turn} TURN`;
    el.classList.remove('hidden');

    // Position based on player's logicY location
    const isPlayer1 = state.turn === 1;
    const ly = isPlayer1 ? state.field.height * 0.7 : state.field.height * 0.3;
    const vy = viewY(ly);
    el.style.top = `${vy}px`;
}

function spawnParticles(x, y, color) {
    for (let i = 0; i < 20; i++) {
        const speed = Math.random() * 6 + 2;
        const ang = Math.random() * Math.PI * 2;
        state.particles.push({
            x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
            life: 1.0, decay: Math.random() * 0.04 + 0.02, color
        });
    }
}

// Draw Loop
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width, h = canvas.height;

    if (state.mode === 'online_client' && state.flipped === undefined) state.flipped = true;

    drawGrid(w, h);

    // Field Markings
    const cy = h / 2;
    ctx.lineWidth = 3; ctx.strokeStyle = '#2a4d53';
    ctx.beginPath(); ctx.moveTo(0, cy - 6); ctx.lineTo(w, cy - 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, cy + 6); ctx.lineTo(w, cy + 6); ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
    ctx.beginPath(); ctx.arc(w / 2, cy, w * 0.2, 0, Math.PI * 2); ctx.stroke();

    // Goals
    const gr = w * 0.32;
    const isFlipped = state.flipped;
    const topCol = isFlipped ? state.p1.color : state.p2.color;
    const botCol = isFlipped ? state.p2.color : state.p1.color;

    // Goal Walls (Solid Corners)
    const goalHalf = viewLen(state.field.width * 0.2); // Goal is center 40%
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    // Top Corners
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w / 2 - goalHalf, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2 + goalHalf, 0); ctx.lineTo(w, 0); ctx.stroke();
    // Bottom Corners
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w / 2 - goalHalf, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2 + goalHalf, h); ctx.lineTo(w, h); ctx.stroke();

    // Goal Keeper / Scoring Markings
    ctx.lineWidth = 3; ctx.shadowBlur = 15;
    // Top Goal Arc
    ctx.shadowColor = topCol; ctx.strokeStyle = topCol;
    ctx.beginPath(); ctx.arc(w / 2, 0, goalHalf, 0, Math.PI, false); ctx.stroke();
    // Top Goal Line (Subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.moveTo(w / 2 - goalHalf, 0); ctx.lineTo(w / 2 + goalHalf, 0); ctx.stroke();

    // Bottom Goal Arc
    ctx.shadowColor = botCol; ctx.strokeStyle = botCol;
    ctx.beginPath(); ctx.arc(w / 2, h, goalHalf, Math.PI, 0, false); ctx.stroke();
    // Bottom Goal Line (Subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.moveTo(w / 2 - goalHalf, h); ctx.lineTo(w / 2 + goalHalf, h); ctx.stroke();
    ctx.shadowBlur = 0;

    // Scores
    const fontSize = h * 0.08;
    ctx.font = `900 ${fontSize}px sans-serif`; ctx.textAlign = "right";
    const topSc = isFlipped ? state.p1.score : state.p2.score;
    const botSc = isFlipped ? state.p2.score : state.p1.score;
    ctx.textBaseline = "top"; ctx.strokeStyle = topCol; ctx.lineWidth = 4;
    ctx.strokeText(topSc.toString(), w - 25, 25);
    ctx.textBaseline = "bottom"; ctx.strokeStyle = botCol;
    ctx.strokeText(botSc.toString(), w - 25, h - 25);

    // Objects
    drawPuck(state.puck);
    drawPaddle(state.p1);
    drawPaddle(state.p2);

    // Particles
    state.particles.forEach(p => {
        ctx.globalAlpha = p.life; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(viewX(p.x), viewY(p.y), 3, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    requestAnimationFrame(draw);
}

function drawGrid(w, h) {
    const cols = 5, rows = 9;
    const cw = w / cols, ch = h / rows, g = 5;
    ctx.strokeStyle = '#0a2025'; ctx.lineWidth = 2;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            ctx.beginPath();
            ctx.roundRect(c * cw + g, r * ch + g, cw - g * 2, ch - g * 2, 8);
            ctx.stroke();
        }
    }
}

function drawPaddle(p) {
    const vx = viewX(p.x), vy = viewY(p.y), vr = viewLen(p.radius);
    ctx.shadowBlur = 15; ctx.shadowColor = p.color; ctx.strokeStyle = p.color;
    ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(vx, vy, vr, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(vx, vy, Math.max(0, vr - 8), 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawPuck(p) {
    const vx = viewX(p.x), vy = viewY(p.y), vr = viewLen(p.radius);
    ctx.shadowBlur = 15; ctx.shadowColor = '#0ff'; ctx.strokeStyle = '#0ff'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(vx, vy, vr, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowColor = '#fc0'; ctx.strokeStyle = '#fc0'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(vx, vy, vr * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
}

// Update Loop
function update() {
    // Velocity tracking for collisions
    state.p1.vx = state.p1.x - state.p1.prevX; state.p1.vy = state.p1.y - state.p1.prevY;
    state.p1.prevX = state.p1.x; state.p1.prevY = state.p1.y;
    state.p2.vx = state.p2.x - state.p2.prevX; state.p2.vy = state.p2.y - state.p2.prevY;
    state.p2.prevX = state.p2.x; state.p2.prevY = state.p2.y;

    if (state.mode === 'online_host' && conn && conn.open) {
        broadcast({ type: 'state' });
    }

    if (!state.running || state.paused || state.countdown) return;

    if (state.mode === 'cpu') {
        const d = DIFFICULTIES[state.difficulty] || DIFFICULTIES['medium'];
        let tx = state.field.width / 2, ty = state.field.height * 0.15;

        if (state.awaitingServe && state.turn === 2) {
            tx = state.field.width / 2 + (Math.random() - 0.5) * 100;
            ty = state.field.height * 0.15 + 50;
        } else if (state.puck.y < state.field.height / 2) {
            // Puck is on Bot's side - ATTACK
            tx = state.puck.x;
            const puckSpeed = Math.hypot(state.puck.vx, state.puck.vy);

            if (puckSpeed < 2 || state.puck.vy > 0) {
                // If puck is slow or moving away slightly but still on our side, move behind it to strike
                ty = state.puck.y - state.puck.radius - 20;
            } else {
                // Defensive tracking
                ty = state.puck.y - 40;
            }

            // Limit how far down the bot can go to attack (don't cross midline)
            ty = Math.min(ty, state.field.height / 2 - state.p2.radius);
        } else {
            // Puck is on player's side - DEFEND / POSITION
            tx = state.puck.x + (Math.random() - 0.5) * d.error;
            ty = state.field.height * 0.15;
        }

        state.p2.x += (tx - state.p2.x) * d.speed;
        state.p2.y += (ty - state.p2.y) * d.speed;
    }

    if (state.awaitingServe) {
        const p = state.turn === 1 ? state.p1 : state.p2;
        const offset = state.turn === 1 ? -(p.radius + state.puck.radius + 5) : (p.radius + state.puck.radius + 5);
        state.puck.x = p.x;
        state.puck.y = p.y + offset;

        // Check for "flick" to serve
        const speed = Math.hypot(p.vx, p.vy);
        if (speed > 2) {
            state.awaitingServe = false;
            state.puck.vx = p.vx * 1.5;
            state.puck.vy = p.vy * 1.5;
            updateTurnUI();
            if (state.mode === 'online_host') broadcast({ type: 'state', event: 'serve' });
        }

        if (state.mode === 'online_host' && conn && conn.open) broadcast({ type: 'state' });
        return;
    }

    if (state.mode === 'online_client') {
        if (conn && conn.open) {
            conn.send({ type: 'input', x: state.p2.x / state.field.width, y: state.p2.y / state.field.height });
        }
        updateParticles();
        return;
    }


    // Puck
    state.puck.x += state.puck.vx; state.puck.y += state.puck.vy;
    state.puck.vx *= CONFIG.friction; state.puck.vy *= CONFIG.friction;

    // Walls
    if (state.puck.x < state.puck.radius) { state.puck.x = state.puck.radius; state.puck.vx *= -CONFIG.wallBounce; playSound('wall'); }
    if (state.puck.x > state.field.width - state.puck.radius) { state.puck.x = state.field.width - state.puck.radius; state.puck.vx *= -CONFIG.wallBounce; playSound('wall'); }

    // Goal & Corner Physics
    const goalGate = state.field.width * 0.2; // Half-width of goal (40% total)
    const gMin = state.field.width / 2 - goalGate;
    const gMax = state.field.width / 2 + goalGate;

    // Top Boundary
    if (state.puck.y < state.puck.radius) {
        if (state.puck.x > gMin && state.puck.x < gMax) {
            if (state.puck.y < 0) handleGoal(1);
        } else {
            state.puck.y = state.puck.radius;
            state.puck.vy *= -CONFIG.wallBounce;
            playSound('wall');
        }
    }
    // Bottom Boundary
    else if (state.puck.y > state.field.height - state.puck.radius) {
        if (state.puck.x > gMin && state.puck.x < gMax) {
            if (state.puck.y > state.field.height) handleGoal(2);
        } else {
            state.puck.y = state.field.height - state.puck.radius;
            state.puck.vy *= -CONFIG.wallBounce;
            playSound('wall');
        }
    }

    // Collisions
    checkCollision(state.p1); checkCollision(state.p2);
    updateParticles();
}

function updateParticles() {
    state.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life -= p.decay; });
    state.particles = state.particles.filter(p => p.life > 0);
}

function checkCollision(p) {
    const dx = state.puck.x - p.x, dy = state.puck.y - p.y;
    const dist = Math.hypot(dx, dy), minDist = state.puck.radius + p.radius;
    if (dist < minDist) {
        const ang = Math.atan2(dy, dx), ov = minDist - dist;
        state.puck.x += Math.cos(ang) * ov; state.puck.y += Math.sin(ang) * ov;
        const dot = state.puck.vx * Math.cos(ang) + state.puck.vy * Math.sin(ang);
        state.puck.vx = (state.puck.vx - 2 * dot * Math.cos(ang)) + p.vx * 1.5;
        state.puck.vy = (state.puck.vy - 2 * dot * Math.sin(ang)) + p.vy * 1.5;
        const speed = Math.hypot(state.puck.vx, state.puck.vy);
        if (speed > state.puck.maxSpeed) {
            state.puck.vx = (state.puck.vx / speed) * state.puck.maxSpeed;
            state.puck.vy = (state.puck.vy / speed) * state.puck.maxSpeed;
        }
        playSound('hit');
    }
}

function handleGoal(s, vOnly = false) {
    playSound('score');
    if (s === 1) { spawnParticles(state.puck.x, 0, state.p1.color); if (!vOnly) state.p1.score++; }
    else { spawnParticles(state.puck.x, state.field.height, state.p2.color); if (!vOnly) state.p2.score++; }
    if (!vOnly) {
        state.turn = state.turn === 1 ? 2 : 1; // Alternate turn
        if (state.mode === 'online_host') {
            broadcast({ type: 'state', event: 'score', scorer: s, nextTurn: state.turn });
            setTimeout(() => broadcast({ type: 'reset' }), 100);
        }
        if (state.p1.score >= CONFIG.winningScore || state.p2.score >= CONFIG.winningScore) endGame(state.p1.score >= CONFIG.winningScore);
        else resetPositions();
    }
}

// Peer Logic
let peer = null, conn = null, isHost = false;
function initPeer() {
    if (peer) return;
    const sid = localStorage.getItem('tron_hockey_peer_id');
    peer = new Peer(sid, { debug: 1 });
    peer.on('open', id => {
        localStorage.setItem('tron_hockey_peer_id', id);
        document.getElementById('peer-id-input').value = id;
        document.getElementById('lobby-status').textContent = "READY TO CONNECT";
        const gameId = new URLSearchParams(window.location.search).get('game') || new URLSearchParams(window.location.search).get('join');
        if (gameId && gameId !== id) {
            document.getElementById('connect-id-input').value = gameId;
            setTimeout(() => connectToPeer(gameId), 500);
        }
    });
    peer.on('error', err => {
        if (err.type === 'unavailable-id') { peer.destroy(); peer = null; initPeer(); }
        else if (err.type === 'peer-unavailable') showAlert("NOT FOUND", "Host offline.");
        console.error(err);
    });
    peer.on('connection', c => { if (conn) conn.close(); conn = c; isHost = true; setupConn(); });
}

function setupConn() {
    conn.on('open', () => {
        document.getElementById('connection-status').textContent = "CONNECTED!";
        setTimeout(() => { document.getElementById('lobby-modal').classList.add('hidden'); startGame(isHost ? 'online_host' : 'online_client'); }, 1000);
    });
    conn.on('data', d => {
        if (state.mode === 'online_host' && d.type === 'input') {
            state.p2.x = d.x * state.field.width; state.p2.y = d.y * state.field.height;
        } else if (state.mode === 'online_client') {
            if (d.type === 'state') {
                state.p1.x = d.p1.x * state.field.width; state.p1.y = d.p1.y * state.field.height;
                state.p2.x = d.p2.x * state.field.width; state.p2.y = d.p2.y * state.field.height;
                state.p1.score = d.scores.p1; state.p2.score = d.scores.p2;
                state.puck.x = d.puck.x * state.field.width; state.puck.y = d.puck.y * state.field.height;
                state.puck.vx = d.puck.vx * state.field.width; state.puck.vy = d.puck.vy * state.field.height;
                state.turn = d.scores.turn;
                state.awaitingServe = d.scores.awaitingServe;
                updateTurnUI();
                if (d.event === 'score') handleGoal(d.scorer, true);
            } else if (d.type === 'reset') { resize(); resetPositions(); }
            else if (d.type === 'countdown') startCountdown();
            else if (d.type === 'game_over') endGame(d.p1Won);
        }
    });
    conn.on('close', () => {
        if (state.running) {
            document.getElementById('player-left-modal').classList.remove('hidden');
        }
    });
}

function broadcast(m) {
    if (conn && conn.open) {
        conn.send({
            ...m,
            p1: { x: state.p1.x / state.field.width, y: state.p1.y / state.field.height },
            p2: { x: state.p2.x / state.field.width, y: state.p2.y / state.field.height },
            puck: { x: state.puck.x / state.field.width, y: state.puck.y / state.field.height, vx: state.puck.vx / state.field.width, vy: state.puck.vy / state.field.height },
            scores: { p1: state.p1.score, p2: state.p2.score, turn: state.turn, awaitingServe: state.awaitingServe }
        });
    }
}

// UI
window.startGame = (m) => {
    state.mode = m;
    state.difficulty = document.getElementById('difficulty-select').value || 'medium';
    state.running = true;
    state.p1.score = 0;
    state.p2.score = 0;
    state.turn = Math.random() < 0.5 ? 1 : 2; // Random first turn
    resize();
    resetPositions();
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
    startCountdown();
};

window.selectDiff = (diff, btn) => {
    document.getElementById('difficulty-select').value = diff;
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
};

window.startCountdown = () => {
    resetPositions(); state.countdown = true;
    const ov = document.getElementById('countdown-overlay'), tx = document.getElementById('countdown-text');
    ov.classList.remove('hidden'); let c = 3; tx.textContent = c; playSound('countdown');
    const itv = setInterval(() => {
        c--; if (c > 0) { tx.textContent = c; playSound('countdown'); }
        else if (c === 0) { tx.textContent = "GO!"; playSound('go'); }
        else { clearInterval(itv); ov.classList.add('hidden'); state.countdown = false; }
    }, 1000);
    if (state.mode === 'online_host') broadcast({ type: 'countdown' });
};

window.handleInput = (lx, ly) => {
    if (!state.running) return;
    let p = (state.mode === 'online_client') ? state.p2 : state.p1;
    if (state.mode === 'local' && ly < state.field.height / 2) p = state.p2;
    const isHost = (p === state.p1);
    const min = isHost ? state.field.height / 2 + p.radius : p.radius;
    const max = isHost ? state.field.height - p.radius : state.field.height / 2 - p.radius;
    p.x = Math.max(p.radius, Math.min(state.field.width - p.radius, lx));
    p.y = Math.max(min, Math.min(max, ly));
};

canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    handleInput(logicX(e.clientX - r.left), logicY(e.clientY - r.top));
});

canvas.addEventListener('touchmove', e => {
    e.preventDefault(); const r = canvas.getBoundingClientRect();
    for (let t of e.touches) handleInput(logicX(t.clientX - r.left), logicY(t.clientY - r.top));
}, { passive: false });

window.openLobby = () => {
    if (!navigator.onLine) {
        document.getElementById('offline-modal').classList.remove('hidden');
        return;
    }
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('lobby-modal').classList.remove('hidden');
    initPeer();
};
window.copyPeerId = () => {
    navigator.clipboard.writeText(document.getElementById('peer-id-input').value);
    document.getElementById('lobby-status').textContent = "ID COPIED!";
    setTimeout(() => { document.getElementById('lobby-status').textContent = "READY TO CONNECT"; }, 2000);
};

window.openShareModal = () => {
    const id = document.getElementById('peer-id-input').value;
    if (!id) return;

    const container = document.getElementById('qrcode-container');
    container.innerHTML = ""; // Clear old one

    // Generate QR code locally (Free, Offline, Forever)
    const url = window.location.origin + window.location.pathname + "?join=" + id;
    new QRCode(container, {
        text: url,
        width: 220,
        height: 220,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    document.getElementById('share-modal').classList.remove('hidden');
};

window.copyShareLink = () => {
    const id = document.getElementById('peer-id-input').value;
    const url = window.location.origin + window.location.pathname + "?join=" + id;
    navigator.clipboard.writeText(url);
    showAlert("COPIED", "Game link copied to clipboard!");
};

window.openJoinOptions = () => {
    document.getElementById('join-options-modal').classList.remove('hidden');
};

window.openJoinInput = () => {
    document.getElementById('join-options-modal').classList.add('hidden');
    document.getElementById('join-id-modal').classList.remove('hidden');
};

window.connectToPeerFromInput = () => {
    const id = document.getElementById('connect-id-input').value.trim();
    if (!id) return;
    connectToPeer(id);
    document.getElementById('join-id-modal').classList.add('hidden');
};

window.connectToPeer = (targetId) => {
    const id = targetId || document.getElementById('connect-id-input').value.trim();
    if (!id) return;
    conn = peer.connect(id, { reliable: false });
    isHost = false;
    setupConn();
};

let html5QrCode = null;

window.openScanner = () => {
    document.getElementById('join-options-modal').classList.add('hidden');
    document.getElementById('scanner-modal').classList.remove('hidden');

    html5QrCode = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
            // Success: can be a URL or a raw ID (from 1D barcode)
            const id = extractIdFromUrl(decodedText);
            stopScanner();
            if (id) connectToPeer(id);
        },
        (errorMessage) => { /* ignore scanning errors */ }
    ).catch(err => {
        showAlert("CAMERA ERROR", "Please ensure camera permissions are granted.");
        stopScanner();
    });
};

function extractIdFromUrl(text) {
    // If it's a URL, extract 'join' param. If it's just a string, it's the ID.
    try {
        const url = new URL(text);
        return url.searchParams.get('join') || url.searchParams.get('game') || text;
    } catch (e) {
        return text;
    }
}

window.stopScanner = async () => {
    if (html5QrCode) {
        try {
            await html5QrCode.stop();
        } catch (e) { }
        html5QrCode = null;
    }
    document.getElementById('scanner-modal').classList.add('hidden');
};
window.togglePause = () => { state.paused = !state.paused; document.getElementById('pause-modal').classList.toggle('hidden', !state.paused); };
window.stopGame = () => {
    state.running = false;
    if (conn) { conn.close(); conn = null; }
    const input = document.getElementById('connect-id-input');
    if (input) input.value = '';
    document.getElementById('main-menu').classList.remove('hidden');
    document.getElementById('game-ui').classList.add('hidden');
    document.getElementById('pause-modal').classList.add('hidden');
    document.getElementById('game-over-modal').classList.add('hidden');
    showMainMenu();
};
window.toggleFlip = () => { state.flipped = !state.flipped; };

window.showCpuMenu = () => {
    document.getElementById('mode-menu').classList.add('hidden');
    document.getElementById('cpu-menu').classList.remove('hidden');
};

window.showMainMenu = () => {
    document.getElementById('cpu-menu').classList.add('hidden');
    document.getElementById('mode-menu').classList.remove('hidden');
};

window.closeLobby = () => {
    if (conn) { conn.close(); conn = null; }
    const input = document.getElementById('connect-id-input');
    if (input) input.value = '';
    document.getElementById('lobby-modal').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
};

window.returnToMenu = () => {
    document.getElementById('game-over-modal').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
    showMainMenu();
};

window.restartGame = () => {
    document.getElementById('game-over-modal').classList.add('hidden');
    startGame(state.mode);
};

window.endGame = (w) => {
    state.running = false; if (state.mode === 'online_host') broadcast({ type: 'game_over', p1Won: w });
    const title = document.getElementById('game-over-title');
    if (state.mode === 'local') {
        const winner = w ? "PLAYER 1" : "PLAYER 2";
        const color = w ? state.p1.color : state.p2.color;
        title.textContent = winner + " WINS";
        title.style.background = "none";
        title.style.webkitTextFillColor = color;
        title.style.filter = `drop-shadow(0 0 15px ${color})`;
    } else {
        const win = (state.mode === 'online_client') ? !w : w;
        title.textContent = win ? "YOU WIN" : "YOU LOSE";
        title.style.background = ""; // Restore default
        title.style.webkitTextFillColor = "";
        title.style.filter = "";
    }
    document.getElementById('game-over-score').textContent = `${state.p1.score} - ${state.p2.score}`;
    document.getElementById('game-over-modal').classList.remove('hidden');
};

window.showAlert = (t, m) => { document.getElementById('alert-title').textContent = t; document.getElementById('alert-message').textContent = m; document.getElementById('alert-modal').classList.remove('hidden'); };


setInterval(update, 1000 / 60);
requestAnimationFrame(draw);
window.addEventListener('resize', resize);
setTimeout(() => { resize(); updateVersionDisplay(); }, 100);

window.updateVersionDisplay = () => {
    const v = localStorage.getItem('app_version') || '1.2.9';
    const display = document.getElementById('app-version-display');
    if (display) display.textContent = `v${v}`;
};

window.performUpdate = async () => {
    const modal = document.getElementById('loading-modal');
    const bar = document.getElementById('update-progress-bar');
    const status = document.getElementById('loading-status');
    const updateModal = document.getElementById('update-modal');

    if (updateModal) updateModal.classList.add('hidden');
    if (modal) modal.classList.remove('hidden');

    const setProgress = (p, text) => {
        if (bar) bar.style.width = p + '%';
        if (status) status.textContent = text;
    };

    try {
        setProgress(10, "INITIALIZING...");
        await new Promise(r => setTimeout(r, 600));

        if (window.pendingVersion) {
            localStorage.setItem('app_version', window.pendingVersion);
        }
        setProgress(30, "CLEANING CACHE...");
        await new Promise(r => setTimeout(r, 800));

        // Clear Service Worker Caches
        if ('caches' in window) {
            const keys = await caches.keys();
            for (let i = 0; i < keys.length; i++) {
                await caches.delete(keys[i]);
                setProgress(30 + ((i + 1) / keys.length) * 30, `DELETING: ${keys[i]}`);
            }
        }

        setProgress(70, "UNREGISTERING SYSTEMS...");
        await new Promise(r => setTimeout(r, 600));

        // Unregister Service Workers
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (let i = 0; i < regs.length; i++) {
                await regs[i].unregister();
                setProgress(70 + ((i + 1) / regs.length) * 20, "SYSTEM DETACHED");
            }
        }

        setProgress(100, "SYSTEM REBOOT...");
        await new Promise(r => setTimeout(r, 800));
        window.location.reload(true);
    } catch (e) {
        console.error("Update failed", e);
        window.location.reload(true);
    }
};

window.updateApp = async () => {
    if (!navigator.onLine) {
        document.getElementById('offline-modal').classList.remove('hidden');
        return;
    }

    const btn = document.getElementById('update-app-btn');
    if (btn) btn.textContent = "CHECKING...";

    try {
        const response = await fetch('version.json?t=' + Date.now());
        const data = await response.json();
        const current = localStorage.getItem('app_version') || '1.0.0';

        if (data.version !== current) {
            window.pendingVersion = data.version;
            const modal = document.getElementById('update-modal');
            if (modal) modal.classList.remove('hidden');
            if (btn) btn.textContent = "UPDATE FOUND!";
        } else {
            if (btn) btn.textContent = "UP TO DATE";
            setTimeout(() => { if (btn) btn.textContent = "CHECK UPDATES"; }, 2000);
        }
    } catch (e) {
        console.error("Update check failed", e);
        if (btn) btn.textContent = "CHECK FAILED";
        setTimeout(() => { if (btn) btn.textContent = "CHECK UPDATES"; }, 2000);
    }
};
window.shareApp = () => {
    const url = window.location.origin + window.location.pathname;
    if (navigator.share) {
        navigator.share({
            title: 'Tron Hockey',
            text: 'Play Tron Hockey - Neon League 1v1!',
            url: url
        }).catch(err => console.log('Share failed', err));
    } else {
        const tempInput = document.createElement('input');
        tempInput.value = url;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
        showAlert("LINK COPIED", "App URL copied! Share it with your friends.");
    }
};

function copyToClipboard(t, l) { navigator.clipboard.writeText(t).then(() => console.log(l + " copied")); }

// PWA Installation Logic
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const modal = document.getElementById('install-modal');
    if (modal) modal.classList.remove('hidden');
});

const installBtn = document.getElementById('install-btn');
if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User Choice: ${outcome}`);
        deferredPrompt = null;
        const modal = document.getElementById('install-modal');
        if (modal) modal.classList.add('hidden');
    });
}

window.addEventListener('appinstalled', (e) => {
    console.log('App Installed');
    deferredPrompt = null;
    const modal = document.getElementById('install-modal');
    if (modal) modal.classList.add('hidden');
});
