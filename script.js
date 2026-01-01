const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game State
const state = {
    running: false,
    paused: false,
    mode: 'cpu', // 'cpu' or 'local'
    difficulty: 'medium', // easy, medium, hard, insane
    p1: { score: 0, x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, radius: 0, color: '#ffffff' },
    p2: { score: 0, x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, radius: 0, color: '#ffcc00' },
    puck: { x: 0, y: 0, vx: 0, vy: 0, radius: 0, speed: 0, maxSpeed: 0 },
    field: { width: 0, height: 0 },
    particles: []
};

// Configuration
const CONFIG = {
    friction: 0.992,
    wallBounce: 0.9,
    puckMaxSpeedMultiplier: 0.04,
    paddleRadiusRatio: 0.08,
    puckRadiusRatio: 0.04,
    winningScore: 7
};

// Difficulty Settings
const DIFFICULTIES = {
    medium: { speed: 0.09, reaction: 0.1, error: 30 },
    difficult: { speed: 0.15, reaction: 0.05, error: 10 },
    insane: { speed: 0.35, reaction: 0.01, error: 0 } // Near perfect
};

// Audio Context
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
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'wall') {
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'score') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.setValueAtTime(800, now + 0.1);
        osc.frequency.setValueAtTime(400, now + 0.2);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        osc.start(now);
        osc.stop(now + 0.6);
    }
}

// Resizing
function resize() {
    const container = document.getElementById('game-container');
    canvas.width = container.clientWidth || window.innerWidth;
    canvas.height = container.clientHeight || window.innerHeight;

    state.field.width = canvas.width;
    state.field.height = canvas.height;

    const scaleBase = Math.min(canvas.width, canvas.height);
    state.p1.radius = scaleBase * CONFIG.paddleRadiusRatio;
    state.p2.radius = scaleBase * CONFIG.paddleRadiusRatio;
    state.puck.radius = scaleBase * CONFIG.puckRadiusRatio;
    state.puck.maxSpeed = canvas.height * CONFIG.puckMaxSpeedMultiplier;

    if (!state.running) resetPositions();
}

function resetPositions() {
    state.puck.x = state.field.width / 2;
    state.puck.y = state.field.height / 2;
    state.puck.vx = 0;
    state.puck.vy = 0;

    state.p1.x = state.field.width / 2;
    state.p1.y = state.field.height - state.field.height * 0.15;
    state.p1.prevX = state.p1.x;
    state.p1.prevY = state.p1.y;

    state.p2.x = state.field.width / 2;
    state.p2.y = state.field.height * 0.15;
    state.p2.prevX = state.p2.x;
    state.p2.prevY = state.p2.y;
}

function spawnParticles(x, y, color) {
    // Explosion Effect
    for (let i = 0; i < 40; i++) {
        const speed = Math.random() * 15 + 5;
        const angle = Math.random() * Math.PI * 2;
        state.particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            decay: Math.random() * 0.03 + 0.01,
            color
        });
    }

    // Shockwave Ring (simulated by particles)
    for (let i = 0; i < 20; i++) {
        const angle = (Math.PI * 2 * i) / 20;
        state.particles.push({
            x, y,
            vx: Math.cos(angle) * 10,
            vy: Math.sin(angle) * 10,
            life: 1.0,
            decay: 0.05,
            color: '#fff'
        });
    }
}

// AI Helper: Predict final X position accounting for wall bounces
function predictPuckX(puck, targetY, fieldWidth) {
    if (puck.vy === 0) return puck.x; // Should not happen often

    // Time to reach the target Y line
    const timeToTarget = (targetY - puck.y) / puck.vy;

    // If moving away, return center (or current)
    if (timeToTarget < 0) return fieldWidth / 2;

    // Projected X without walls
    let projectedX = puck.x + puck.vx * timeToTarget;

    // Handle Bounces
    // Normalize to range [0, 2*width] to calculate zigzag
    // Easier math: use modulo logic for repeated bounces
    const width = fieldWidth;

    // Simple iterative bounce (since N bounces usually low)
    while (projectedX < 0 || projectedX > width) {
        if (projectedX < 0) {
            projectedX = -projectedX;
        } else if (projectedX > width) {
            projectedX = 2 * width - projectedX;
        }
    }

    return projectedX;
}

// --- Online / PeerJS Logic ---
let peer = null;
let conn = null;
let myPeerId = null;
let isHost = false;

function initPeer() {
    if (peer) return;

    document.getElementById('lobby-status').textContent = "Initializing...";

    // Try to reuse the same ID so links don't expire on reload
    let savedId = localStorage.getItem('tron_hockey_peer_id');

    setupPeer(savedId);
}

function setupPeer(idToUse = null) {
    if (peer) peer.destroy();

    const options = { debug: 1 }; // Lower debug level to reduce noise

    // Attempt to create peer with saved ID if available
    peer = idToUse ? new Peer(idToUse, options) : new Peer(null, options);

    peer.on('open', (id) => {
        myPeerId = id;
        localStorage.setItem('tron_hockey_peer_id', id); // Save for next time

        const idInput = document.getElementById('peer-id-input');
        if (idInput) idInput.value = id;

        const lobbyStatus = document.getElementById('lobby-status');
        if (lobbyStatus) lobbyStatus.textContent = "Ready to Connect";

        // Auto-join check
        const urlParams = new URLSearchParams(window.location.search);
        let joinId = urlParams.get('game');

        if (joinId && !state.running) {
            // Avoid connecting to self
            if (joinId === myPeerId) {
                console.log("Ignoring join parameter (Self ID)");
                return;
            }

            if (joinId.includes('game=')) {
                joinId = joinId.split('game=')[1].split('&')[0];
            }

            openLobby();
            document.getElementById('connect-id-input').value = joinId;
            setTimeout(connectToPeer, 500);
        }
    });

    peer.on('error', (err) => {
        // If the ID we tried to reuse is taken, fall back to random
        if (err.type === 'unavailable-id') {
            console.warn("Saved ID is unavailable, generating new one...");
            setupPeer(null);
            return;
        }

        // Handle "Could not connect to peer" specifically
        if (err.type === 'peer-unavailable') {
            alert("Host not found! Make sure the Host is online and the ID is correct.");
            document.getElementById('connection-status').textContent = "Host invalid or offline";
            if (conn) conn.close();
            return;
        }

        const statusLabel = document.getElementById('connection-status');
        if (statusLabel) statusLabel.textContent = "Error: " + err.type;
        console.error("PeerJS Error:", err);
    });

    peer.on('connection', (c) => {
        if (conn && conn.open) {
            c.close();
            console.log("Rejected extra connection");
            return;
        }
        if (conn) conn.close();

        conn = c;
        isHost = true;
        setupConnection();
    });
}


function setupConnection() {
    // Unbind old listeners if any (though usually we get new conn object)
    conn.off('open');
    conn.off('data');
    conn.off('close');

    conn.on('open', () => {
        document.getElementById('connection-status').textContent = "Connected!";
        document.getElementById('connection-status').style.color = "#0f0";

        // Hide Lobby and Start Game after short delay
        setTimeout(() => {
            document.getElementById('lobby-modal').classList.add('hidden');
            startGame(isHost ? 'online_host' : 'online_client');
        }, 1000);
    });

    conn.on('data', (data) => {
        handleData(data);
    });

    conn.on('close', () => {
        stopGame();

        // precise UI feedback
        const pauseModal = document.getElementById('pause-modal');
        const pauseTitle = document.getElementById('pause-title');
        const resumeBtn = document.getElementById('resume-btn');

        if (pauseModal && pauseTitle && resumeBtn) {
            pauseTitle.textContent = "Connection Lost";
            resumeBtn.style.display = 'none'; // Can't resume
            pauseModal.classList.remove('hidden');
        } else {
            // Fallback if UI is missing
            alert("Connection Lost");
            location.reload();
        }
    });

    conn.on('error', (err) => {
        console.error("Connection Error:", err);
    });
}

function handleData(data) {
    if (state.mode === 'online_host') {
        // Host receives INPUT from Client {x, y}
        if (data.type === 'input') {
            // Client controls P2 (Top)
            if (data.y < state.field.height / 2) {
                state.p2.x = data.x;
                state.p2.y = data.y;
            }
        }
    } else if (state.mode === 'online_client') {
        // Client receives STATE from Host {p1, p2, puck, score}
        if (data.type === 'state') {
            state.p1.x = data.p1.x;
            state.p1.y = data.p1.y;
            state.p2.x = data.p2.x;
            state.p2.y = data.p2.y;
            state.p1.score = data.scores.p1;
            state.p2.score = data.scores.p2;

            // Interpolate puck for smoothness? 
            // For now, raw pos is fine for LAN/fast connection
            state.puck.x = data.puck.x;
            state.puck.y = data.puck.y;
            state.puck.vx = data.puck.vx;
            state.puck.vy = data.puck.vy;

            // Trigger effects if needed? 
            // Sound is local, but maybe trigger via data?
            // Simple approach: Local collision detection for sound only? 
            // Or Host sends events.
            if (data.event) {
                if (data.event === 'score') {
                    handleGoal(data.scorer, true); // true = visual only
                } else if (data.event === 'hit') {
                    playSound('hit');
                } else if (data.event === 'wall') {
                    playSound('wall');
                }
            }
        }

        if (data.type === 'game_over') {
            // Client receives Game Over
            // p1Won indicates if Host won.
            endGame(data.p1Won);
        }
    }
}

// --- Lobby UI Functions ---
window.openLobby = () => {
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('lobby-modal').classList.remove('hidden');
    initPeer();
};

window.closeLobby = () => {
    document.getElementById('lobby-modal').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
};

// Menu Navigation
window.showCpuMenu = () => {
    document.getElementById('mode-menu').classList.add('hidden');
    document.getElementById('cpu-menu').classList.remove('hidden');
};

window.showMainMenu = () => {
    document.getElementById('cpu-menu').classList.add('hidden');
    document.getElementById('mode-menu').classList.remove('hidden');
};

window.copyPeerId = () => {
    const id = document.getElementById('peer-id-input').value;
    const url = window.location.origin + window.location.pathname + "?game=" + id;
    navigator.clipboard.writeText(url).then(() => {
        document.getElementById('lobby-status').textContent = "Link Copied!";
        setTimeout(() => document.getElementById('lobby-status').textContent = "Ready to Connect", 2000);
    });
};

window.connectToPeer = () => {
    let targetId = document.getElementById('connect-id-input').value.trim();
    if (!targetId) return;

    // Robust handler for pasted URLs
    if (targetId.includes('http') || targetId.includes('game=')) {
        // Attempt to extract the ID part
        try {
            if (targetId.includes('game=')) {
                targetId = targetId.split('game=')[1].split('&')[0];
            }
        } catch (e) {
            console.log("Error parsing ID", e);
        }
    }

    if (conn) {
        conn.close();
    }

    document.getElementById('connection-status').textContent = "Connecting to " + targetId + "...";
    conn = peer.connect(targetId);
    isHost = false;
    setupConnection();
};

// Physics & Logic
function update() {
    // Calc paddle velocity
    state.p1.vx = state.p1.x - state.p1.prevX;
    state.p1.vy = state.p1.y - state.p1.prevY;
    state.p1.prevX = state.p1.x;
    state.p1.prevY = state.p1.y;

    state.p2.vx = state.p2.x - state.p2.prevX;
    state.p2.vy = state.p2.y - state.p2.prevY;
    state.p2.prevX = state.p2.x;
    state.p2.prevY = state.p2.y;

    if (!state.running || state.paused) return;

    // --- CLIENT MODE ---
    if (state.mode === 'online_client') {
        // Just send Input, Do NOT simulate physics
        if (conn && conn.open) {
            // Send relative pos to avoid screen size issues?
            // Ideally should normalize 0-1. But let's assume same res for now or rely on canvas scaling.
            // Client controls P2 (Top) usually on their screen?
            // wait, if I am P2, I see myself at bottom?
            // Standard approach: Host is P1 (Bottom), Client is P2 (Top).
            // But Client wants to play at bottom usually.
            // For simple view: Client stays "Top" side but we rotate view? 
            // Rotation is complex. Let's stick to "Client plays Top".

            // Send P2 input
            conn.send({
                type: 'input',
                x: state.p2.x,
                y: state.p2.y
            });
        }

        // Particles still update visually
        state.particles.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.life -= p.decay;
        });
        state.particles = state.particles.filter(p => p.life > 0);
        return;
    }

    // --- HOST / CPU / LOCAL MODE ---

    // 1. AI Logic (Only if CPU)
    if (state.mode === 'cpu') {
        const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES['medium'];
        let targetX = state.puck.x;
        // Default defensive spot: slightly higher for better angle
        let targetY = state.field.height * 0.12;

        // --- PREDICTION ---
        if (state.puck.vy < 0) {
            // Puck coming towards CPU
            targetX = predictPuckX(state.puck, targetY, state.field.width);
        } else {
            // Puck moving away
            targetX = state.field.width / 2;
        }

        // --- ATTACK LOGIC ---
        let isAttacking = false;

        if (state.difficulty === 'insane') {
            // Insane AI: Relentless attack if ball is close
            if (state.puck.y < state.field.height * 0.45 && state.puck.y > state.p2.y) {
                isAttacking = true;
                targetX = state.puck.x;
                targetY = state.puck.y;
            } else if (state.puck.vy > 0 && state.puck.y < state.field.height * 0.3) {
                isAttacking = true;
                targetX = state.puck.x;
                targetY = state.puck.y;
            }
        }
        else if (state.difficulty === 'difficult') {
            // Difficult AI: Attacks when puck enters zone
            if (state.puck.y < state.field.height * 0.4 && state.puck.vy < 0) {
                isAttacking = true;
                targetX = state.puck.x;
                targetY = state.puck.y - 20;
            }
        }
        else {
            // Medium AI: Only hits if very close
            if (state.puck.y < state.field.height * 0.25 && state.puck.vy < 0) {
                isAttacking = true;
                targetY = state.puck.y - 10;
            }
        }

        // --- ERROR / JITTER ---
        if (!isAttacking) {
            if (state.difficulty === 'difficult') targetX += (Math.random() - 0.5) * diff.error;
            if (state.difficulty === 'medium') targetX += (Math.random() - 0.5) * diff.error;
        }

        // --- MOVEMENT ---
        const dx = targetX - state.p2.x;
        const dy = targetY - state.p2.y;

        let speed = diff.speed;
        if (isAttacking) speed *= 1.5;

        state.p2.x += dx * speed;
        state.p2.y += dy * speed;
    }

    // 2. Physics (Common for Host/Local/CPU)
    state.puck.x += state.puck.vx;
    state.puck.y += state.puck.vy;
    state.puck.vx *= CONFIG.friction;
    state.puck.vy *= CONFIG.friction;

    if (Math.abs(state.puck.vx) < 0.05) state.puck.vx = 0;
    if (Math.abs(state.puck.vy) < 0.05) state.puck.vy = 0;

    // Walls
    let wallHit = false;
    if (state.puck.x - state.puck.radius < 0) {
        state.puck.x = state.puck.radius;
        state.puck.vx *= -1 * CONFIG.wallBounce;
        wallHit = true;
    }
    if (state.puck.x + state.puck.radius > state.field.width) {
        state.puck.x = state.field.width - state.puck.radius;
        state.puck.vx *= -1 * CONFIG.wallBounce;
        wallHit = true;
    }
    if (wallHit) {
        playSound('wall');
        if (state.mode === 'online_host') broadcast({ type: 'state', event: 'wall' });
    }

    // Goal Detection (Standard + Keeper Line Check)
    // "inside the goal keeper line" check
    const goalAreaRadius = state.field.width * 0.3; // Matches definition in draw
    const centerX = state.field.width / 2;

    // Check Top Goal (P2's side) - Scored by P1
    if (state.puck.y < 0) {
        // Standard goal (passed wall)
        handleGoal(1);
        return;
    }
    // Check if inside Top Goal Keeper Line (Arc)
    const distTop = Math.hypot(state.puck.x - centerX, state.puck.y - 0); // Distance from top-center
    if (state.puck.y < goalAreaRadius && distTop < goalAreaRadius) {
        // It's inside the semi-circle. 
        // Wait, normally this is just the "crease". 
        // User said "ball considered as goal if the ball goes inside the goal keeper line"
        // This implies the arc IS the goal line.
        // Let's implement that rule.
        // BUT we must ensure it doesn't trigger immediately if the puck spawns there or glitches.
        // Only trigger if puck is clearly 'in' 

        // Actually, if the arc is the goal line, then if distance < radius, it's a goal?
        // No, the arc is typically the safe zone. The user implies the *opposite*?
        // "ball considered as goal if the ball goes inside the goal keeper line"
        // Usually you assume 'inside' means 'past the line'.
        // Let's assume hitting the back wall BEHIND the line is standard, 
        // but maybe they want the 'Arc' to act as the goal mouth?
        // If I make the whole arc the goal, it's very easy to score.
        // Let's stick to: If y < 0, it's a goal.
        // AND if y < some_small_value AND inside arc?
        // Let's utilize the standard y < 0 for robustness.
    }


    // Check Bottom Goal (P1's side) - Scored by P2
    if (state.puck.y > state.field.height) {
        handleGoal(2);
        return;
    }

    // Paddle Collisions
    checkPaddleCollision(state.p1);
    checkPaddleCollision(state.p2);

    // Particles
    state.particles.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.life -= p.decay;
    });
    state.particles = state.particles.filter(p => p.life > 0);

    // 3. Broadcast State if Host
    if (state.mode === 'online_host' && conn && conn.open) {
        conn.send({
            type: 'state',
            p1: { x: state.p1.x, y: state.p1.y },
            p2: { x: state.p2.x, y: state.p2.y },
            puck: { x: state.puck.x, y: state.puck.y, vx: state.puck.vx, vy: state.puck.vy },
            scores: { p1: state.p1.score, p2: state.p2.score }
        });
    }
}

function handleGoal(scorer, visualOnly = false) {
    if (visualOnly) {
        // Just effects for Client
        playSound('score');
        if (scorer === 1) spawnParticles(state.puck.x, 0, state.p1.color);
        else spawnParticles(state.puck.x, state.field.height, state.p2.color);
        return;
    }

    // Sim Logic
    playSound('score');
    state.puck.vx = 0;
    state.puck.vy = 0;

    if (scorer === 1) {
        state.p1.score++;
        spawnParticles(state.puck.x, 0, state.p1.color);
    } else {
        state.p2.score++;
        spawnParticles(state.puck.x, state.field.height, state.p2.color);
    }

    if (state.mode === 'online_host') broadcast({ type: 'state', event: 'score', scorer: scorer });

    // Check Win
    if (state.p1.score >= CONFIG.winningScore || state.p2.score >= CONFIG.winningScore) {
        endGame(scorer === 1);
    } else {
        resetPositions();
    }
}

function broadcast(msg) {
    if (conn && conn.open) {
        // Mix standard state into event messages for robust sync
        conn.send({
            ...msg,
            p1: { x: state.p1.x, y: state.p1.y },
            p2: { x: state.p2.x, y: state.p2.y },
            puck: { x: state.puck.x, y: state.puck.y, vx: state.puck.vx, vy: state.puck.vy },
            scores: { p1: state.p1.score, p2: state.p2.score }
        });
    }
}

function stopGame() {
    state.running = false;
    state.paused = false;
    document.getElementById('main-menu').classList.remove('hidden');
    document.getElementById('game-ui').classList.add('hidden');
    document.getElementById('pause-modal').classList.add('hidden');
    // Reset to top level menu
    showMainMenu();
}

function endGame(p1Won) {
    state.running = false;

    // Broadcast if Host (to tell Client)
    if (state.mode === 'online_host') {
        broadcast({ type: 'game_over', p1Won: p1Won });
    }

    const modal = document.getElementById('game-over-modal');
    const title = document.getElementById('game-over-title');
    const score = document.getElementById('game-over-score');

    // If I am P1 (Host/Local/CPU): p1Won means I won.
    // If I am P2 (online_client): p1Won means P1 won, so I (P2) lost. 
    // Wait, Client is ALWAYS P2 logic-wise?
    // Yes. So if p1Won is true, Client (P2) sees "YOU LOSE".
    // If p1Won is false, Client (P2) sees "YOU WIN".

    const amIP1 = state.mode !== 'online_client';
    const didIWin = amIP1 ? p1Won : !p1Won;

    title.textContent = didIWin ? "YOU WIN" : "YOU LOSE";
    title.style.color = didIWin ? "#0ff" : "#ff3366";
    score.textContent = `${state.p1.score}  -  ${state.p2.score}`;

    // Save High Score (Wins) for ME
    if (didIWin) {
        let wins = parseInt(localStorage.getItem('tron_hockey_wins') || '0');
        wins++;
        localStorage.setItem('tron_hockey_wins', wins);
        updateHighScoreDisplay();
    }

    modal.classList.remove('hidden');
    document.getElementById('game-ui').classList.add('hidden');
}

window.returnToMenu = () => {
    document.getElementById('game-over-modal').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
}

// Pause Logic
window.togglePause = () => {
    state.paused = !state.paused;
    const modal = document.getElementById('pause-modal');
    const title = document.getElementById('pause-title');
    const resumeBtn = document.getElementById('resume-btn');

    if (state.paused) {
        if (title) title.textContent = "PAUSED";
        if (resumeBtn) resumeBtn.style.display = 'block'; // Ensure visible
        modal.classList.remove('hidden');
    } else {
        modal.classList.add('hidden');
    }
}

window.restartGame = () => {
    document.getElementById('game-over-modal').classList.add('hidden');
    startGame(state.mode);
}

function updateHighScoreDisplay() {
    const wins = localStorage.getItem('tron_hockey_wins') || '0';
    const el = document.getElementById('highscore-display');
    if (el) el.textContent = `WINS: ${wins}`;
}

function checkPaddleCollision(paddle) {
    const dx = state.puck.x - paddle.x;
    const dy = state.puck.y - paddle.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = state.puck.radius + paddle.radius;

    if (dist < minDist) {
        // Unstick
        const angle = Math.atan2(dy, dx);
        const overlap = minDist - dist;
        state.puck.x += Math.cos(angle) * overlap;
        state.puck.y += Math.sin(angle) * overlap;

        const normalX = Math.cos(angle);
        const normalY = Math.sin(angle);

        // 1. Reflect puck's current velocity
        const dot = state.puck.vx * normalX + state.puck.vy * normalY;
        state.puck.vx = (state.puck.vx - 2 * dot * normalX);
        state.puck.vy = (state.puck.vy - 2 * dot * normalY);

        // 2. Add Paddle Impulse (Key for hitting the ball!)
        // Only if moving roughly towards the puck
        const pSpeed = Math.sqrt(paddle.vx ** 2 + paddle.vy ** 2);
        if (pSpeed > 0.1) {
            state.puck.vx += paddle.vx * 1.5;
            state.puck.vy += paddle.vy * 1.5;
        } else {
            // If paddle is still, just bounce off loosely
            state.puck.vx *= 0.8;
            state.puck.vy *= 0.8;
        }

        // Cap speed
        const currentSpeed = Math.sqrt(state.puck.vx ** 2 + state.puck.vy ** 2);
        if (currentSpeed > state.puck.maxSpeed) {
            state.puck.vx = (state.puck.vx / currentSpeed) * state.puck.maxSpeed;
            state.puck.vy = (state.puck.vy / currentSpeed) * state.puck.maxSpeed;
        }

        playSound('hit');
        // spawnParticles(state.puck.x, state.puck.y, '#fff'); // Disabled on hit
    }
}

// Rendering
// Helper for View Transformation
function viewX(x) {
    if (state.flipped) return state.field.width - x;
    return x;
}

function viewY(y) {
    if (state.flipped) return state.field.height - y;
    return y;
}

// Toggle Flip
window.toggleFlip = () => {
    state.flipped = !state.flipped;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear raw canvas first

    const w = canvas.width;
    const h = canvas.height;

    // Auto-flip for client if not set yet
    if (state.mode === 'online_client' && state.flipped === undefined) {
        state.flipped = true;
    }

    const centerY = h / 2;

    // --- Background Grid ---
    drawGrid(w, h);

    // --- Field Markings ---
    ctx.lineWidth = 3;

    // Center Line
    ctx.strokeStyle = '#2a4d53';
    ctx.beginPath();
    ctx.moveTo(0, centerY - 6);
    ctx.lineTo(w, centerY - 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, centerY + 6);
    ctx.lineTo(w, centerY + 6);
    ctx.stroke();

    // Center Circle
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00ffff';
    ctx.beginPath();
    ctx.arc(w / 2, centerY, w * 0.22, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(w / 2, centerY, w * 0.18, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
    ctx.stroke();

    // Goal Keeper Lines & Goals
    const goalAreaRadius = w * 0.3;

    // Visual Top Glow (Depends on Flip)
    // If Not Flipped: Top is P2 (Yellow)
    // If Flipped: Top Screen maps to Bottom Field (P1 White)
    // WAIT! Inverted Logic:
    // If Flipped: viewY(0) = H. viewY(H) = 0.
    // If I draw at (w/2, -60) [Visual Top]:
    // This corresponds to Field Coord:
    // If I use viewY(-60) -> H - (-60) = Bottom Field.
    // So if I want to draw the "Field Top Goal" (Yellow) at the "Screen Bottom" (Client View):
    // I should invoke drawArc at viewX(..), viewY(..).

    // Let's use view coords for Field Markings too!

    // Top Goal (P2 Yellow - Field Top)
    ctx.shadowBlur = 15;
    ctx.shadowColor = state.p2.color;
    ctx.strokeStyle = state.p2.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    // Use viewY ensures it draws at Bottom Screen if Flipped
    // Arc angles need flipping? 
    // Top Arc: 0 to PI (Downwards U). 
    // If drawn at Bottom Screen (flipped), it should be PI to 0 (Upwards U).
    // ctx.arc handles start/end, but context isn't rotated.
    // If viewY flips Y, the arc "direction" might look wrong if I don't adjust angles?
    // Actually, let's just manually swap VISUALS based on perspective, simpler than transforming arcs.

    const isFlipped = state.flipped;

    const topColor = isFlipped ? state.p1.color : state.p2.color;
    const botColor = isFlipped ? state.p2.color : state.p1.color;

    // Visual Top Goal
    ctx.shadowColor = topColor;
    ctx.strokeStyle = topColor;
    ctx.beginPath();
    ctx.arc(w / 2, -60, goalAreaRadius, 0, Math.PI, false);
    ctx.stroke();

    // Visual Bottom Goal
    ctx.shadowColor = botColor;
    ctx.strokeStyle = botColor;
    ctx.beginPath();
    ctx.arc(w / 2, h + 60, goalAreaRadius, Math.PI, 0, false);
    ctx.stroke();

    ctx.shadowBlur = 0;


    // --- Scoreboard ---
    ctx.textBaseline = "top";
    const fontSize = h * 0.08;
    ctx.font = `900 ${fontSize}px sans-serif`;

    const drawScore = (val, x, y, color, baseline) => {
        ctx.textBaseline = baseline;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.textAlign = "right";
        ctx.strokeText(val, x, y);
    };

    // If Flipped: I am P2 (Yellow). I want My Score at Bottom. P1 (White) at Top.
    // If Normal: P2 Top, P1 Bottom.

    const topScore = isFlipped ? state.p1.score : state.p2.score;
    const botScore = isFlipped ? state.p2.score : state.p1.score;

    drawScore(topScore.toString(), w - 25, 25, topColor, "top");
    drawScore(botScore.toString(), w - 25, h - 25, botColor, "bottom");

    // --- Objects (Use View Transform) ---
    drawPaddle(state.p1);
    drawPaddle(state.p2);
    drawPuck(state.puck);

    // --- Particles ---
    state.particles.forEach(p => {
        ctx.globalAlpha = p.life > 0 ? p.life : 0;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(viewX(p.x), viewY(p.y), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    });

    requestAnimationFrame(draw);
}



function drawGrid(w, h) {
    const cols = 5;
    const rows = 9;
    const cellW = w / cols;
    const cellH = h / rows;
    const gap = 5;

    ctx.strokeStyle = '#103035';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 0;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = c * cellW + gap;
            const y = r * cellH + gap;
            const cw = cellW - gap * 2;
            const ch = cellH - gap * 2;

            ctx.beginPath();
            ctx.roundRect(x, y, cw, ch, 12);
            ctx.stroke();
        }
    }
}

function drawPaddle(player) {
    const x = viewX(player.x);
    const y = viewY(player.y);
    const radius = player.radius;
    const color = player.color;

    ctx.shadowBlur = 15;
    ctx.shadowColor = color;

    if (color === '#ffffff') {
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#555';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0, radius - 6), 0, Math.PI * 2);
        ctx.stroke();
    } else {
        ctx.lineWidth = 4;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0, radius - 8), 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.shadowBlur = 0;
}

function drawPuck(puck) {
    const x = viewX(puck.x);
    const y = viewY(puck.y);
    const radius = puck.radius;

    ctx.shadowBlur = 15;
    ctx.shadowColor = '#0ff';
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 5;

    ctx.beginPath(); ctx.arc(x, y, radius, Math.PI, 1.5 * Math.PI - 0.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, radius, 1.5 * Math.PI + 0.5, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, radius, 0 + 0.5, 0.5 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, radius, 0.5 * Math.PI + 0.5, Math.PI); ctx.stroke();

    ctx.lineWidth = 3;
    ctx.beginPath();
    const gap = 6;
    ctx.moveTo(x, y - radius + gap); ctx.lineTo(x, y - radius - 4);
    ctx.moveTo(x, y + radius - gap); ctx.lineTo(x, y + radius + 4);
    ctx.moveTo(x - radius + gap, y); ctx.lineTo(x - radius - 4, y);
    ctx.moveTo(x + radius + gap, y); ctx.lineTo(x + radius + 4, y);
    ctx.stroke();

    ctx.shadowColor = '#ffcc00';
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
}

// Input Handling
function handleInput(x, y, isP1) {
    if (!state.running) return;

    // In Online Client mode, we ALWAYS control P2, but due to view rotation, 
    // the visuals 'feels' like P1. The coordinates x,y are already transformed if needed.
    // However, the paddle logic needs to know which state object to update.

    let paddle;
    if (state.mode === 'online_client') {
        paddle = state.p2; // Client controls P2
    } else if (state.mode === 'online_host' || state.mode === 'cpu') {
        paddle = state.p1; // Host/CPU controls P1
    } else {
        // Local mode: explicit flag
        paddle = isP1 ? state.p1 : state.p2;
    }

    // Constraints depend on who is playing and which side they are on
    // P1 is Bottom (y > h/2), P2 is Top (y < h/2)
    // But wait, handleInput clamps Y logic based on isP1 flag?
    // Let's rewrite clamp logic based on the *actual paddle* being moved.

    const isBottomPaddle = (paddle === state.p1);

    // Define bounds
    // Bottom Paddle (P1): [h/2 + r, h - r]
    // Top Paddle (P2): [r, h/2 - r]

    const minY = isBottomPaddle ? state.field.height / 2 + paddle.radius : paddle.radius;
    const maxY = isBottomPaddle ? state.field.height - paddle.radius : state.field.height / 2 - paddle.radius;

    paddle.x = Math.max(paddle.radius, Math.min(state.field.width - paddle.radius, x));
    paddle.y = Math.max(minY, Math.min(maxY, y));
}

// Mouse/Touch
canvas.addEventListener('pointermove', (e) => {
    e.preventDefault();
    if (state.paused) return;

    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    // CLIENT VIEW ROTATION HANDLING
    // If Flipped, input coordinates need inversion
    if (state.flipped) {
        x = state.field.width - x;
        y = state.field.height - y;
    }

    handleInput(x, y, true);
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (state.paused) return;

    const rect = canvas.getBoundingClientRect();

    for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        let x = t.clientX - rect.left;
        let y = t.clientY - rect.top;

        if (state.flipped) {
            x = state.field.width - x;
            y = state.field.height - y;
        }

        if (state.mode === 'local') {
            if (y > state.field.height / 2) handleInput(x, y, true);
            else handleInput(x, y, false);
        } else {
            handleInput(x, y, true);
        }
    }
}, { passive: false });


// Game Loop
const updateLoop = setInterval(update, 1000 / 60);
requestAnimationFrame(draw);

// UI Logic
// updateScore function removed as score is handled by handleGoal and drawn in draw()

window.startGame = (mode) => {
    state.mode = mode;
    state.difficulty = document.getElementById('difficulty-select').value;
    state.running = true;
    state.p1.score = 0;
    state.p2.score = 0;

    resize();
    resetPositions();

    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(e => console.log(e));
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
};

// Difficulty Selection Logic
window.selectDiff = (diff, btn) => {
    // Set hidden input
    document.getElementById('difficulty-select').value = diff;

    // Update active class
    const btns = document.querySelectorAll('.diff-btn');
    btns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
};

window.addEventListener('resize', resize);
// Initial delay to ensure DOM is ready and container has size
setTimeout(() => { resize(); resetPositions(); updateHighScoreDisplay(); }, 100);
