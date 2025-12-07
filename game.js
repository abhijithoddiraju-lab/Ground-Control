const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;

let lastTime = 0;
let playing = true;
let score = 0;

// Wave system
let wave = 1;
let waveTime = 0; // seconds elapsed in current wave
const waveDuration = 12; // seconds to survive to advance
let enemiesSpawnedThisWave = 0;

// Wave transition (slow-motion) effect
let timeScale = 1; // multiplies physics dt (1 = normal)
let waveTransitionEnd = 0; // timestamp (ms) when slow-mo ends

const gravity = 1400;
const frictionGround = 0.995;
const restitution = 0.7;

const input = { w:false, s:false, a:false, d:false };

// Allow pause via Space as well
window.addEventListener("keydown", e=>{
  if (e.code === 'Space') togglePause();
});

const ground = {
  cx: W * 0.5,
  cy: H * 0.72,
  length: W * 1.8,
  angle: 0,
  elevationSpeed: 260,
  angleSpeed: Math.PI * 0.6,
  thickness: 24
};

const ball = {
  x: ground.cx - 120,
  y: ground.cy - 100,
  r: 18,
  vx: 0,
  vy: 0,
  omega: 0
};

// (trails removed)

const obstacles = [];
const obstacleCfg = {
  spawnInterval: 1400,
  lastSpawn: 0,
  speed: 220,
  size: 34
};

// SETTINGS (persisted)
const settings = {
  enemiesBase: 1,
  healthPackIntervalSec: 12,
  groundThickness: ground.thickness,
  damagePerEnemy: 10
};

// Health and health packs
ball.maxHealth = 100;
ball.health = ball.maxHealth;

const healthPacks = [];
const hpCfg = {
  spawnInterval: settings.healthPackIntervalSec * 1000,
  lastSpawn: 0,
  size: 14,
  healAmount: 28
};

// visual collision markers for verification
const collisionMarkers = [];
// screen shake
let shakeUntil = 0, shakeMag = 0;

// Particles for collision FX
const particles = [];

function spawnParticles(x,y,color,count,spread,baseSpeed){
  for (let i=0;i<count;i++){
    const ang = Math.random() * Math.PI * 2;
    const spd = baseSpeed * (0.6 + Math.random() * 0.9);
    particles.push({
      x:x, y:y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: 0.45 + Math.random() * 0.45,
      age: 0,
      color: color,
      size: 2 + Math.random() * 3
    });
  }
}

// update particles (called from update)
function updateParticles(dt){
  for (let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) { particles.splice(i,1); continue; }
    p.vy += 700 * dt; // gravity on particles
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function drawParticles(ctx){
  for (const p of particles){
    const a = 1 - (p.age / p.life);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// helper: find deepest circle-vs-polygon segment collision info (if any)
function polygonCollisionInfo(circle, points){
  let best = null;
  for (let i=0;i<points.length;i++){
    const a = points[i];
    const b = points[(i+1)%points.length];
    const seg = {x1:a.x,y1:a.y,x2:b.x,y2:b.y};
    const info = circleSegmentCollision(circle, seg);
    if (info.collided){
      if (!best || info.penetration > best.penetration) {
        best = info;
      }
    }
  }
  return best;
}

// utility: compute normalized vector
function normalize(x,y){
  const L = Math.sqrt(x*x + y*y) || 1;
  return {x: x / L, y: y / L};
}

// compute polygon points for different shapes around center
function computeShapePoints(o){
  const s = o.size;
  const cx = o.x, cy = o.y;
  const pts = [];
  const rot = o.rot || 0;
  if (o.shape === 'circle'){
    return null; // will be drawn as arc
  }
  if (o.shape === 'triangle'){
    pts.push({x: cx + Math.cos(rot) * 0 - Math.sin(rot) * -s, y: cy + Math.sin(rot) * 0 + Math.cos(rot) * -s});
    pts.push({x: cx + Math.cos(rot) * -s * 0.866 - Math.sin(rot) * (s*0.5), y: cy + Math.sin(rot) * -s * 0.866 + Math.cos(rot) * (s*0.5)});
    pts.push({x: cx + Math.cos(rot) * s * 0.866 - Math.sin(rot) * (s*0.5), y: cy + Math.sin(rot) * s * 0.866 + Math.cos(rot) * (s*0.5)});
    return pts;
  }
  if (o.shape === 'diamond'){
    pts.push({x: cx, y: cy - s});
    pts.push({x: cx - s, y: cy});
    pts.push({x: cx, y: cy + s});
    pts.push({x: cx + s, y: cy});
    // rotate points around center by rot
    return pts.map(p=>{
      const dx = p.x - cx, dy = p.y - cy;
      return { x: cx + dx * Math.cos(rot) - dy * Math.sin(rot), y: cy + dx * Math.sin(rot) + dy * Math.cos(rot) };
    });
  }
  if (o.shape === 'hexagon'){
    for (let i=0;i<6;i++){
      const a = rot + i * Math.PI*2/6;
      pts.push({ x: cx + Math.cos(a) * s, y: cy + Math.sin(a) * s });
    }
    return pts;
  }
  // fallback: triangle
  return [ {x:cx-s, y:cy}, {x:cx, y:cy-s}, {x:cx+s, y:cy} ];
}

/* INPUT */
window.addEventListener("keydown", e=>{
  if (e.key==="w") input.w = true;
  if (e.key==="s") input.s = true;
  if (e.key==="a") input.a = true;
  if (e.key==="d") input.d = true;
  if (e.key==="r") resetGame();
  if (e.key==="p") togglePause();
});
window.addEventListener("keyup", e=>{
  if (e.key==="w") input.w = false;
  if (e.key==="s") input.s = false;
  if (e.key==="a") input.a = false;
  if (e.key==="d") input.d = false;
});

document.getElementById("restartBtn").onclick = resetGame;
document.getElementById("pauseBtn").onclick = togglePause;
const startBtn = document.getElementById('startBtn');
if (startBtn) startBtn.addEventListener('click', startGame);
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', ()=>{ applySettingsFromUI(); });
const testCollBtn = document.getElementById('testCollBtn');
if (testCollBtn) testCollBtn.addEventListener('click', ()=>{ spawnCollisionTest(); });

// hook slider live updates for the settings UI (if present)
function wireSettingsSliders(){
  const e = document.getElementById('settingEnemies');
  const ev = document.getElementById('settingEnemiesVal');
  const h = document.getElementById('settingHpInterval');
  const hv = document.getElementById('settingHpIntervalVal');
  const g = document.getElementById('settingGroundThickness');
  const gv = document.getElementById('settingGroundThicknessVal');
  const d = document.getElementById('settingDamage');
  const dv = document.getElementById('settingDamageVal');
  if (e && ev){ e.oninput = ()=> ev.textContent = e.value; }
  if (h && hv){ h.oninput = ()=> hv.textContent = h.value; }
  if (g && gv){ g.oninput = ()=> gv.textContent = g.value; }
  if (d && dv){ d.oninput = ()=> dv.textContent = d.value; }
}
wireSettingsSliders();

// Show home screen initially
const homeScreenEl = document.getElementById('homeScreen');
function showHome() { if (homeScreenEl) homeScreenEl.style.display = 'flex'; }
function hideHome() { if (homeScreenEl) homeScreenEl.style.display = 'none'; }

// ensure settings UI is populated when showing home
const origShowHome = showHome;
function showHome(pauseMode = false){
  loadSettingsToUI();
  // adjust start button text depending on whether this is pause overlay
  const startBtnEl = document.getElementById('startBtn');
  if (startBtnEl) {
    if (pauseMode) {
      startBtnEl.textContent = 'Play (apply settings)';
      // resume without resetting the game
      startBtnEl.onclick = ()=>{
        applySettingsFromUI();
        hideHome();
        // resume game without resetting
        if (!playing) {
          playing = true;
          lastTime = performance.now();
          const pb = document.getElementById('pauseBtn'); if (pb) pb.textContent = 'Pause';
          requestAnimationFrame(loop);
        }
      };
    } else {
      startBtnEl.textContent = 'Start Game';
      startBtnEl.onclick = startGame;
    }
  }
  if (homeScreenEl) homeScreenEl.style.display = 'flex';
  wireSettingsSliders();
}

function startGame() {
  hideHome();
  resetGame();
}

// Apply settings from inputs (and persist to localStorage)
function applySettingsFromUI(){
  const eEl = document.getElementById('settingEnemies');
  const hpEl = document.getElementById('settingHpInterval');
  const gEl = document.getElementById('settingGroundThickness');
  const dEl = document.getElementById('settingDamage');
  if (eEl) settings.enemiesBase = Math.max(1, parseInt(eEl.value) || 1);
  if (hpEl) settings.healthPackIntervalSec = Math.max(2, parseFloat(hpEl.value) || 12);
  if (gEl) settings.groundThickness = Math.max(4, Math.min(120, parseInt(gEl.value) || 24));
  if (dEl) settings.damagePerEnemy = Math.max(1, Math.min(200, parseInt(dEl.value) || 10));
  // apply
  ground.thickness = settings.groundThickness;
  hpCfg.spawnInterval = settings.healthPackIntervalSec * 1000;
  // persist
  try{ localStorage.setItem('gc_settings', JSON.stringify(settings)); }catch(e){}
}

function loadSettingsToUI(){
  try{
    const raw = localStorage.getItem('gc_settings');
    if (raw) {
      const s = JSON.parse(raw);
      settings.enemiesBase = s.enemiesBase || settings.enemiesBase;
      settings.healthPackIntervalSec = s.healthPackIntervalSec || settings.healthPackIntervalSec;
      settings.groundThickness = s.groundThickness || settings.groundThickness;
    }
  }catch(e){}
  // set UI inputs if present
  const eEl = document.getElementById('settingEnemies');
  const hpEl = document.getElementById('settingHpInterval');
  const gEl = document.getElementById('settingGroundThickness');
  if (eEl) eEl.value = settings.enemiesBase;
  if (hpEl) hpEl.value = settings.healthPackIntervalSec;
  if (gEl) gEl.value = settings.groundThickness;
  const dEl = document.getElementById('settingDamage');
  const dv = document.getElementById('settingDamageVal');
  if (dEl) dEl.value = settings.damagePerEnemy;
  if (dv) dv.textContent = settings.damagePerEnemy;
  // apply to game
  ground.thickness = settings.groundThickness;
  hpCfg.spawnInterval = settings.healthPackIntervalSec * 1000;
}

/* GROUND HELPERS */
function getGroundEndpoints() {
  const hx = Math.cos(ground.angle);
  const hy = Math.sin(ground.angle);
  const half = ground.length / 2;

  return {
    x1: ground.cx - hx * half,
    y1: ground.cy - hy * half,
    x2: ground.cx + hx * half,
    y2: ground.cy + hy * half
  };
}

function groundYAtX(x) {
  const g = getGroundEndpoints();
  const t = (x - g.x1) / (g.x2 - g.x1);
  return g.y1 + t * (g.y2 - g.y1);
}

/* CIRCLE vs SEGMENT COLLISION */
function circleSegmentCollision(circle, seg) {
  const ax = seg.x1, ay = seg.y1;
  const bx = seg.x2, by = seg.y2;

  const abx = bx - ax, aby = by - ay;
  const abLen2 = abx*abx + aby*aby;
  let t = ((circle.x - ax) * abx + (circle.y - ay) * aby) / abLen2;

  t = Math.max(0, Math.min(1, t));

  const px = ax + abx * t;
  const py = ay + aby * t;

  const dx = circle.x - px;
  const dy = circle.y - py;

  const dist2 = dx*dx + dy*dy;
  const r = circle.r;
  // optional segment thickness (treat segment as a thick strip)
  const segThickness = seg.thickness || 0;
  const allowed = (r + segThickness * 0.5);

  if (dist2 <= allowed * allowed) {
    const dist = Math.max(0.0001, Math.sqrt(dist2));
    return {
      collided: true,
      nx: dx / dist,
      ny: dy / dist,
      penetration: allowed - dist
    };
  }
  return { collided:false };
}

/* TRIANGLE COLLISION */
function circlePolygonCollision(c, points) {
  for (let i=0;i<points.length;i++){
    const a = points[i];
    const b = points[(i+1)%points.length];
    const seg = {x1:a.x,y1:a.y,x2:b.x,y2:b.y};
    if (circleSegmentCollision(c, seg).collided) return true;
  }
  return false;
}

/* SPAWN OBSTACLES */
function spawnObstacle() {
  // Spawn from canvas edges so enemies are visible to the player
  const fromLeft = Math.random() < 0.5;
  const offset = 60 + Math.random() * 120;
  const spawnX = fromLeft ? -offset : (W + offset);

  // Pick a visible vertical range (upper half of the canvas) so flying enemies are on-screen
  const baseY = 60 + Math.random() * (H * 0.7);
  const s = obstacleCfg.size;
  const phase = Math.random() * Math.PI * 2;

  // choose a random shape for variety
  const shapes = ['triangle','diamond','hexagon','circle'];
  const shape = shapes[Math.floor(Math.random()*shapes.length)];

  // initial lateral velocity toward center (positive => right)
  const baseSpeed = obstacleCfg.speed * (0.6 + Math.random() * 0.6);
  const vxInitial = fromLeft ? baseSpeed : -baseSpeed;

  // initial rotation
  const rot = (Math.random()-0.5) * 0.6;

  obstacles.push({
    x: spawnX,
    baseY: baseY,
    y: baseY,
    size: s,
    phase: phase,
    vx: vxInitial,
    vy: (Math.random() - 0.5) * 20,
    vxTarget: vxInitial,
    vyTarget: (Math.random() - 0.5) * 20,
    wobbleFreq: 0.0015 + Math.random() * 0.003,
    wobbleMag: 8 + Math.random() * 28,
    lastChange: performance.now(),
    changeInterval: 800 + Math.random() * 1600,
    rot: rot,
    rotSpeed: (Math.random()-0.5) * 1.2,
    shape: shape,
    targetX: Math.random() * W,
    targetY: 40 + Math.random() * (H - 80)
  });
}

function spawnHealthPack(){
  const x = 40 + Math.random() * (W - 80);
  const y = 40 + Math.random() * (H * 0.5);
  healthPacks.push({ x:x, y:y, baseY:y, r: hpCfg.size, vx: (Math.random()-0.5)*40, vy: (Math.random()-0.5)*20, phase: Math.random()*Math.PI*2, wobbleFreq: 0.001 + Math.random()*0.004 });
}

// Top-level collision test helper (spawns overlapping obstacles and positions ball)
function spawnCollisionTest(){
  const cx = W * 0.5, cy = H * 0.35;
  const s = obstacleCfg.size;
  const a = { x: cx - s*0.3, baseY: cy, y: cy, size: s, vx: 10, vy: 0, vxTarget: 60, vyTarget:0, wobbleFreq:0.002, wobbleMag:6, lastChange:performance.now(), changeInterval:1200, rot:0, rotSpeed:0.2, shape:'circle', targetX:cx+200, targetY:cy };
  const b = { x: cx + s*0.3, baseY: cy, y: cy, size: s, vx: -10, vy: 0, vxTarget: -60, vyTarget:0, wobbleFreq:0.002, wobbleMag:6, lastChange:performance.now(), changeInterval:1200, rot:0, rotSpeed:-0.2, shape:'circle', targetX:cx-200, targetY:cy };
  obstacles.push(a,b);
  // move ball near them
  ball.x = cx; ball.y = cy + 80; ball.vx = 0; ball.vy = -40;
  // spawn a triangle too
  const t1 = { x: cx-160, baseY: cy+40, y: cy+40, size: s, vx: 30, vy:0, vxTarget:30, vyTarget:0, wobbleFreq:0.0015, wobbleMag:4, lastChange:performance.now(), changeInterval:1800, rot:0.2, rotSpeed:0.1, shape:'triangle', targetX:Math.random()*W, targetY:40+Math.random()*(H-80) };
  obstacles.push(t1);
}

function nextWave() {
  wave += 1;
  waveTime = 0;
  enemiesSpawnedThisWave = 0;
  // make waves slightly harder: increase speed and spawn rate a bit
  obstacleCfg.speed = Math.min(800, obstacleCfg.speed + 18);
  obstacleCfg.spawnInterval = Math.max(300, obstacleCfg.spawnInterval * 0.92);
  // small visual/log cue
  try { console.info('Wave ' + wave); } catch (e) {}
  // allow immediate spawn at the start of the new wave
  obstacleCfg.lastSpawn = performance.now() - obstacleCfg.spawnInterval;
  // show a big wave overlay and briefly slow time for a cinematic effect
  showWaveOverlay(wave);
  // refill health at the start of each new wave
  ball.health = ball.maxHealth;
}

function showWaveOverlay(n) {
  const overlay = document.getElementById('waveOverlay');
  if (!overlay) return;
  overlay.textContent = 'Wave ' + n;
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('show');
  // slow-motion effect for 1.4s
  const dur = 1400;
  timeScale = 0.52;
  waveTransitionEnd = performance.now() + dur;
  // hide overlay after dur
  setTimeout(()=>{
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }, dur);
}

/* RESET */
function resetGame() {
  score = 0;
  const scoreEl = document.getElementById("score");
  if (scoreEl) scoreEl.textContent = "Score: 0";
  playing = true;
  // Clear obstacles and reset spawn timer
  obstacles.length = 0;
  // allow the first enemy to spawn immediately
  obstacleCfg.lastSpawn = performance.now() - obstacleCfg.spawnInterval;

  // Reset ground to initial position
  ground.angle = 0;
  ground.cy = H * 0.72;

  // Reset ball near the left of the ground
  ball.x = ground.cx - 120;
  ball.y = ground.cy - 100;
  ball.vx = 0;
  ball.vy = 0;
  ball.omega = 0;

  // Reset UI
  const pauseBtn = document.getElementById("pauseBtn");
  if (pauseBtn) pauseBtn.textContent = "Pause";
  const status = document.getElementById("status");
  if (status) status.textContent = "Status: Playing";

  // Clear canvas immediately
  ctx.clearRect(0,0,W,H);

  // pick a random palette for ground and ball on each restart
  applyRandomPalette();

  // reset health
  ball.maxHealth = 100;
  ball.health = ball.maxHealth;

  // reset health packs
  healthPacks.length = 0;
  hpCfg.lastSpawn = performance.now() - hpCfg.spawnInterval;

  lastTime = performance.now();
  // reset waves
  wave = 1;
  waveTime = 0;
  enemiesSpawnedThisWave = 0;
  obstacleCfg.spawnInterval = 1400;
  obstacleCfg.speed = 220;
  requestAnimationFrame(loop);
}

// Apply a random hue-based palette to CSS variables for ground and ball
function applyRandomPalette(){
  const root = document.documentElement;
  // pick a random base hue
  const h = Math.floor(Math.random() * 360);
  const ground = `hsl(${h} 18% 16%)`;
  const groundHighlight = `hsl(${(h+12)%360} 22% 20%)`;
  const ball = `hsl(${(h+180)%360} 85% 52%)`;
  // set CSS variables
  try{
    root.style.setProperty('--ground', ground);
    root.style.setProperty('--ground-highlight', groundHighlight);
    root.style.setProperty('--ball', ball);
  }catch(e){}
}

function togglePause() {
  // If currently playing, pause and show the home overlay (do not reset)
  if (playing) {
    playing = false;
    const pb = document.getElementById("pauseBtn"); if (pb) pb.textContent = "Resume";
    const statusEl = document.getElementById("status"); if (statusEl) statusEl.textContent = "Status: Paused";
    showHome(true);
    return;
  }
  // Otherwise resume (don't reset unless user explicitly does so)
  playing = true;
  const pb = document.getElementById("pauseBtn"); if (pb) pb.textContent = "Pause";
  const statusEl2 = document.getElementById("status"); if (statusEl2) statusEl2.textContent = "Status: Playing";
  lastTime = performance.now();
  hideHome();
  requestAnimationFrame(loop);
}

/* MAIN LOOP */
function loop(ts) {
  if (!lastTime) lastTime = ts;
  const dt = (ts - lastTime) / 1000;
  lastTime = ts;

  if (playing) {
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
}

/* UPDATE PHYSICS */
function update(dt) {
  // Input → ground control
  if (input.w) ground.cy -= ground.elevationSpeed * dt;
  if (input.s) ground.cy += ground.elevationSpeed * dt;
  if (input.a) ground.angle -= ground.angleSpeed * dt;
  if (input.d) ground.angle += ground.angleSpeed * dt;

  // Clamp angle + elevation — keep angle in a reasonable range (±1 rad)
  ground.angle = Math.max(-1, Math.min(1, ground.angle));
  ground.cy = Math.max(H*0.35, Math.min(H*0.9, ground.cy));

  // Gravity
  // Apply timeScale to physics (creates a temporary slow-motion between waves)
  const now = performance.now();
  if (waveTransitionEnd && now > waveTransitionEnd) {
    timeScale = 1;
    waveTransitionEnd = 0;
  }
  const physicsDt = dt * timeScale;

  ball.vy += gravity * physicsDt;

  // Integrate movement (physics dt applied)
  ball.x += ball.vx * physicsDt;
  ball.y += ball.vy * physicsDt;

  // Screen-edge collisions (keep the ball inside the canvas)
  if (ball.x - ball.r < 0) {
    ball.x = ball.r;
    ball.vx = -ball.vx * restitution;
    // visual & particles for wall collision
    spawnParticles(ball.x, ball.y, getComputedStyle(document.documentElement).getPropertyValue('--ball').trim() || '#ffcc00', 10, 12, 160);
    collisionMarkers.push({ x: ball.x, y: ball.y, age:0, life:0.6, color:'#ffd6a6' });
    shakeUntil = performance.now() + 300; shakeMag = 6;
  }
  if (ball.x + ball.r > W) {
    ball.x = W - ball.r;
    ball.vx = -ball.vx * restitution;
    spawnParticles(ball.x, ball.y, getComputedStyle(document.documentElement).getPropertyValue('--ball').trim() || '#ffcc00', 10, 12, 160);
    collisionMarkers.push({ x: ball.x, y: ball.y, age:0, life:0.6, color:'#ffd6a6' });
    shakeUntil = performance.now() + 300; shakeMag = 6;
  }
  if (ball.y - ball.r < 0) {
    ball.y = ball.r;
    ball.vy = -ball.vy * restitution;
    spawnParticles(ball.x, ball.y, getComputedStyle(document.documentElement).getPropertyValue('--ball').trim() || '#ffcc00', 8, 10, 120);
    collisionMarkers.push({ x: ball.x, y: ball.y, age:0, life:0.6, color:'#ffd6a6' });
    shakeUntil = performance.now() + 220; shakeMag = 5;
  }

  // Bottom edge: treat it as a bounce edge as well
  if (ball.y + ball.r > H) {
    ball.y = H - ball.r;
    ball.vy = -ball.vy * restitution;
    // small damping to avoid infinite bounce
    ball.vx *= 0.98;
    spawnParticles(ball.x, ball.y, getComputedStyle(document.documentElement).getPropertyValue('--ball').trim() || '#ffcc00', 10, 14, 160);
    collisionMarkers.push({ x: ball.x, y: ball.y, age:0, life:0.6, color:'#ffd6a6' });
    shakeUntil = performance.now() + 300; shakeMag = 6;
  }

  // No trail: nothing to record

  const seg = getGroundEndpoints();
  // Pass ground thickness into collision check so the hitbox is thicker than the visual center line
  const segWithThickness = { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, thickness: ground.thickness };
  const col = circleSegmentCollision(ball, segWithThickness);

  if (col.collided) {
    ball.x += col.nx * col.penetration;
    ball.y += col.ny * col.penetration;

    const vn = ball.vx * col.nx + ball.vy * col.ny;
    const newVn = -vn * restitution;

    const tx = -col.ny, ty = col.nx;
    const vt = ball.vx * tx + ball.vy * ty;

    const newVt = vt * frictionGround;

    ball.vx = newVn * col.nx + newVt * tx;
    ball.vy = newVn * col.ny + newVt * ty;
  }

  ball.vx *= 0.999;

  // Obstacles
  const now2 = performance.now();
  // Wave timer
  waveTime += dt;

  // Determine enemies to spawn this wave (wave number = count)
  // Determine enemies to spawn this wave using settings
  const enemiesThisWaveTarget = Math.max(1, settings.enemiesBase + (wave - 1));

  if (now - obstacleCfg.lastSpawn > obstacleCfg.spawnInterval) {
    obstacleCfg.lastSpawn = now;
    // Only spawn while we haven't reached this wave's spawn target
    if (enemiesSpawnedThisWave < enemiesThisWaveTarget) {
      spawnObstacle();
      enemiesSpawnedThisWave++;
    }
  }

  // helper: spawn a quick collision test set
  function spawnCollisionTest(){
    // center two obstacles overlapping
    const cx = W * 0.5, cy = H * 0.35;
    const s = obstacleCfg.size;
    const a = { x: cx - s*0.3, baseY: cy, y: cy, size: s, vx: 10, vy: 0, vxTarget: 60, vyTarget:0, wobbleFreq:0.002, wobbleMag:6, lastChange:performance.now(), changeInterval:1200, rot:0, rotSpeed:0.2, shape:'circle', targetX:cx+200, targetY:cy };
    const b = { x: cx + s*0.3, baseY: cy, y: cy, size: s, vx: -10, vy: 0, vxTarget: -60, vyTarget:0, wobbleFreq:0.002, wobbleMag:6, lastChange:performance.now(), changeInterval:1200, rot:0, rotSpeed:-0.2, shape:'circle', targetX:cx-200, targetY:cy };
    obstacles.push(a,b);
    // move ball near them
    ball.x = cx; ball.y = cy + 80; ball.vx = 0; ball.vy = -40;
    // spawn a couple static polygon obstacles too
    const t1 = { x: cx-160, baseY: cy+40, y: cy+40, size: s, vx: 30, vy:0, vxTarget:30, vyTarget:0, wobbleFreq:0.0015, wobbleMag:4, lastChange:performance.now(), changeInterval:1800, rot:0.2, rotSpeed:0.1, shape:'triangle', targetX:Math.random()*W, targetY:40+Math.random()*(H-80) };
    obstacles.push(t1);
  }

  // Advance wave if player survived long enough
  if (waveTime >= waveDuration) {
    nextWave();
  }

  // Update on-screen wave/timer badge
  const waveBadge = document.getElementById('waveBadge');
  if (waveBadge) {
    // show one decimal place for elapsed seconds
    waveBadge.textContent = `Wave ${wave} · ${waveTime.toFixed(1)}s`;
  }

  // Health pack spawning
  if (now2 - hpCfg.lastSpawn > hpCfg.spawnInterval) {
    hpCfg.lastSpawn = now2;
    // spawn random chance
    if (Math.random() < 0.9) spawnHealthPack();
  }

  for (let i=obstacles.length-1; i>=0; i--) {

    const o = obstacles[i];

    // Smoothly interpolate velocities toward targets for gentle movement
    o.vx += ( (o.vxTarget || o.vx) - o.vx ) * 0.08;
    o.vy += ( (o.vyTarget || o.vy) - o.vy ) * 0.08;

    // Apply velocities (use physicsDt so slow-mo affects movement)
    o.x += o.vx * physicsDt;
    o.baseY += o.vy * physicsDt;

    // Bobbing around baseY using obstacle-specific wobble parameters (real time)
    const bob = Math.sin((now2 * o.wobbleFreq) + o.phase) * o.wobbleMag;
    o.y = o.baseY + bob;

    // Occasionally choose new movement target across the screen (smooth multi-directional motion)
    if (now2 - o.lastChange > o.changeInterval) {
      // pick a new target position anywhere on/around the canvas
      o.targetX = -80 + Math.random() * (W + 160);
      o.targetY = 40 + Math.random() * (H - 80);
      // choose new wobble and rotation speed
      o.wobbleFreq = 0.0008 + Math.random() * 0.005;
      o.wobbleMag = 6 + Math.random() * 30;
      o.rotSpeed = (Math.random()-0.5) * 1.2;
      o.lastChange = now2;
      o.changeInterval = 600 + Math.random() * 2000;
    }

    // steer toward target smoothly by setting velocity targets
    const toTarget = { x: o.targetX - o.x, y: o.targetY - o.y };
    const n = normalize(toTarget.x, toTarget.y);
    const speedBase = obstacleCfg.speed * (0.35 + Math.random() * 0.8);
    o.vxTarget = n.x * speedBase;
    o.vyTarget = n.y * speedBase * (0.7 + Math.random() * 0.6);

    // update rotation
    o.rot = (o.rot || 0) + o.rotSpeed * physicsDt;

    // Rebuild polygon points for the current shape
    const s2 = o.size;
    const pts = computeShapePoints(o);
    if (pts) {
      o.points = pts;
    }

    // Update health packs movement below (so they appear to float)
    for (let pi = healthPacks.length - 1; pi >= 0; pi--) {
      const hp = healthPacks[pi];
      // bobbing motion
      hp.baseY += Math.sin((now2 + hp.phase) * hp.wobbleFreq) * 0.0; // baseY stable
      hp.y = hp.baseY + Math.sin((now2 + hp.phase) * hp.wobbleFreq) * 8;
      hp.x += hp.vx * physicsDt;
      hp.y += hp.vy * physicsDt;
      // wrap/keep in bounds
      if (hp.x < 12) { hp.x = 12; hp.vx = Math.abs(hp.vx); }
      if (hp.x > W - 12) { hp.x = W - 12; hp.vx = -Math.abs(hp.vx); }

      // collision with ball
      const dxh = ball.x - hp.x; const dyh = ball.y - hp.y;
      if (dxh*dxh + dyh*dyh <= (ball.r + hp.r) * (ball.r + hp.r)) {
        // pickup
        ball.health = Math.min(ball.maxHealth, ball.health + hpCfg.healAmount);
        spawnParticles(hp.x, hp.y, '#7bf59b', 10, 12, 160);
        healthPacks.splice(pi,1);
      }
    }

    // Collision resolution between ball and obstacle (bounce instead of instant death)
    let collidedInfo = null;
    let contactX = o.x, contactY = o.y;
    if (o.shape === 'circle'){
      const dx = ball.x - o.x;
      const dy = ball.y - o.y;
      const dist2 = dx*dx + dy*dy;
      const rr = ball.r + (o.size * 0.9);
      if (dist2 <= rr*rr) {
        const dist = Math.sqrt(dist2) || 0.0001;
        const nx = dx / dist;
        const ny = dy / dist;
        const penetration = rr - dist;
        collidedInfo = { nx, ny, penetration };
        contactX = o.x + nx * (o.size * 0.45);
        contactY = o.y + ny * (o.size * 0.45);
      }
    } else if (o.points && o.points.length) {
      const info = polygonCollisionInfo(ball, o.points);
      if (info && info.collided) {
        collidedInfo = info;
        // contact point approximate
        contactX = ball.x - info.nx * (ball.r - info.penetration * 0.5);
        contactY = ball.y - info.ny * (ball.r - info.penetration * 0.5);
      }
    }

    if (collidedInfo) {
      // resolve penetration: separate ball and obstacle by inverse-mass weighting
      const mBall = Math.max(6, ball.r * ball.r * 0.12);
      const mObs = Math.max(8, o.size * o.size * 0.02);
      const invB = 1 / mBall;
      const invO = 1 / mObs;
      const invSum = invB + invO;
      const pushBall = (invB / invSum) * collidedInfo.penetration;
      const pushObs = (invO / invSum) * collidedInfo.penetration;
      ball.x += collidedInfo.nx * pushBall;
      ball.y += collidedInfo.ny * pushBall;
      o.x -= collidedInfo.nx * pushObs;
      o.y -= collidedInfo.ny * pushObs;

      // relative velocity along normal
      const rvx = o.vx - ball.vx;
      const rvy = o.vy - ball.vy;
      const relAlong = rvx * collidedInfo.nx + rvy * collidedInfo.ny;
      const e = 0.78; // restitution between ball and enemies
      const j = -(1 + e) * relAlong / invSum;
      const jx = j * collidedInfo.nx;
      const jy = j * collidedInfo.ny;

      // apply impulses
      ball.vx -= jx * invB;
      ball.vy -= jy * invB;
      o.vx += jx * invO;
      o.vy += jy * invO;

      // spawn particles at contact
      const triColor = getComputedStyle(document.documentElement).getPropertyValue('--tri').trim() || '#d9534f';
      const ballColor = getComputedStyle(document.documentElement).getPropertyValue('--ball').trim() || '#ffcc00';
      spawnParticles(contactX, contactY, ballColor, 8, 12, 140);

      // slight rotation kick
      o.rotSpeed += (Math.random()-0.5) * 2;

      // apply damage to ball using configured fixed damage per enemy
      const damage = settings.damagePerEnemy || 10;
      ball.health = Math.max(0, ball.health - damage);
      if (ball.health <= 0) {
        playing = false;
        const statusEl = document.getElementById("status");
        if (statusEl) statusEl.textContent = "Status: Dead! Resetting...";
        // particle big burst
        spawnParticles(ball.x, ball.y, '#ff6b6b', 28, 28, 220);
        setTimeout(resetGame, 700);
        return;
      }
      // continue (don't treat as death)
    }

    if (o.x < -200 || o.x > W + 200) obstacles.splice(i,1);
  }

  // Obstacle vs Obstacle collisions (circle approximation)
  for (let i=0;i<obstacles.length;i++){
    for (let j=i+1;j<obstacles.length;j++){
      const a = obstacles[i];
      const b = obstacles[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist2 = dx*dx + dy*dy;
      const ra = a.size * 0.9;
      const rb = b.size * 0.9;
      const minDist = ra + rb;
      if (dist2 > 0 && dist2 < minDist * minDist) {
        const dist = Math.sqrt(dist2) || 0.0001;
        const nx = dx / dist;
        const ny = dy / dist;
        const penetration = minDist - dist;

        // simple mass by size (area-ish)
        const ma = Math.max(8, a.size);
        const mb = Math.max(8, b.size);
        const invA = 1 / ma;
        const invB = 1 / mb;
        const invSum = invA + invB;

        // push apart proportionally to inverse mass
        const pushA = (invA / invSum) * penetration;
        const pushB = (invB / invSum) * penetration;
        a.x -= nx * pushA;
        a.y -= ny * pushA;
        b.x += nx * pushB;
        b.y += ny * pushB;

        // relative velocity along normal
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const relVelAlong = rvx * nx + rvy * ny;
        if (relVelAlong < 0) {
          // apply impulse (restitution)
          const e = 0.72; // elasticity between enemies
          const j = -(1 + e) * relVelAlong / (invSum);
          const jx = j * nx;
          const jy = j * ny;
          a.vx -= jx * invA;
          a.vy -= jy * invA;
          b.vx += jx * invB;
          b.vy += jy * invB;
        }
      }
    }
  }

  // update particles
  updateParticles(physicsDt);

  // update collision markers
  for (let i=collisionMarkers.length-1;i>=0;i--) {
    const m = collisionMarkers[i];
    m.age += physicsDt;
    if (m.age >= m.life) collisionMarkers.splice(i,1);
  }
}

/* DRAW */
function draw() {
  // Clear frame (no motion blur)
  ctx.clearRect(0,0,W,H);
  // apply screen shake translation if active
  const now = performance.now();
  let shakeX = 0, shakeY = 0;
  if (now < shakeUntil) {
    const t = (shakeUntil - now) / 1000;
    shakeX = (Math.random()*2-1) * shakeMag;
    shakeY = (Math.random()*2-1) * shakeMag;
    ctx.save();
    ctx.translate(shakeX, shakeY);
  } else {
    // no transform
  }
  // Background (use CSS vars)
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, getComputedStyle(document.documentElement).getPropertyValue('--bg-top').trim() || '#071014');
  g.addColorStop(1, getComputedStyle(document.documentElement).getPropertyValue('--bg-bot').trim() || '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);

  // Draw ground
  const e = getGroundEndpoints();
  ctx.save();
  ctx.translate(ground.cx, ground.cy);
  ctx.rotate(ground.angle);
  // Modern rounded ground: draw a thick stroked line with rounded caps and a subtle highlight
  const thick = ground.thickness;
  ctx.lineCap = 'round';
  ctx.lineWidth = thick;
  // shadow / base
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim() || '#0f1720';
  ctx.beginPath();
  ctx.moveTo(-ground.length/2, 0);
  ctx.lineTo(ground.length/2, 0);
  ctx.stroke();
  // highlight
  ctx.lineWidth = Math.max(2, thick * 0.28);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ground-highlight').trim() || '#2b3640';
  ctx.beginPath();
  ctx.moveTo(-ground.length/2 + 6, -2);
  ctx.lineTo(ground.length/2 - 6, -2);
  ctx.stroke();
  ctx.restore();

  // Obstacles
  // obstacles color from CSS variable
  const triColor = getComputedStyle(document.documentElement).getPropertyValue('--tri').trim() || '#d9534f';
  for (const o of obstacles) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot || 0);
    ctx.fillStyle = triColor;
    if (o.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, o.size * 0.9, 0, Math.PI*2);
      ctx.fill();
    } else {
      // draw polygon using computed points in world coords
      if (!o.points || o.points.length === 0) {
        // fallback: small square
        ctx.beginPath(); ctx.rect(-o.size/2, -o.size/2, o.size, o.size); ctx.fill();
      } else {
        ctx.beginPath();
        // points were in world coords; convert to local coords relative to o.x,o.y
        ctx.moveTo(o.points[0].x - o.x, o.points[0].y - o.y);
        for (let i=1;i<o.points.length;i++) ctx.lineTo(o.points[i].x - o.x, o.points[i].y - o.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

    // draw particles on top
    drawParticles(ctx);

    // draw collision markers
    for (const m of collisionMarkers) {
      const a = 1 - (m.age / m.life);
      ctx.beginPath(); ctx.fillStyle = m.color || '#fff';
      ctx.globalAlpha = a; ctx.arc(m.x, m.y, 8 * a, 0, Math.PI*2); ctx.fill(); ctx.globalAlpha = 1;
    }

    // restore after shake
    if (now < shakeUntil) ctx.restore();

  // Ball (no trail)
  const ballColor = (getComputedStyle(document.documentElement).getPropertyValue('--ball').trim() || '#ffcc00');
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI*2);
  ctx.fillStyle = ballColor;
  ctx.fill();

  // draw health bar (top-left)
  const barW = 180;
  const barH = 14;
  const px = 14, py = 14;
  ctx.save();
  // background
  ctx.fillStyle = 'rgba(0,0,0,0.36)';
  roundRect(ctx, px-4, py-4, barW+8, barH+8, 8, true, false);
  // border
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  ctx.strokeRect(px-4, py-4, barW+8, barH+8);
  // health fill
  const healthFrac = Math.max(0, Math.min(1, ball.health / ball.maxHealth));
  ctx.fillStyle = '#2ee6a6';
  ctx.fillRect(px, py, barW * healthFrac, barH);
  // empty
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(px + barW * healthFrac, py, barW * (1 - healthFrac), barH);
  // text
  ctx.font = '12px "Exo 2", system-ui, Arial';
  ctx.fillStyle = '#e6f7fb';
  ctx.fillText(`HP: ${Math.round(ball.health)} / ${ball.maxHealth}`, px + 8, py + barH - 2);
  ctx.restore();

  // draw health packs
  for (const hp of healthPacks) {
    ctx.beginPath(); ctx.fillStyle = '#7bf59b'; ctx.arc(hp.x, hp.y, hp.r, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.fillStyle = '#ffffff'; ctx.fillRect(hp.x - 3, hp.y - 1, 6, 2); ctx.fillRect(hp.x - 1, hp.y - 3, 2, 6);
  }
}
// (no trail helper needed)

// helper: rounded rect
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  if (typeof stroke === 'undefined') stroke = true;
  if (typeof r === 'undefined') r = 5;
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

/* START */
// Do not auto-start; wait for player to press Start on the home screen
showHome();
