/**
 * game.js - Core physics and rendering engine.
 * Uses Matter.js for rigid-body physics with threshold-based magnetic snapping.
 */

const Game = (() => {
  /* -- Constants -------------------------------------------------------- */
  const MAGNET_RADIUS = 14;
  const ACTIVATION_RADIUS = 140;
  const SNAP_RADIUS = 70;
  const LOCK_DISTANCE = MAGNET_RADIUS * 2.15;
  const GRID_SIZE = ACTIVATION_RADIUS;
  const SETTLE_FRAMES = 150;
  const MIN_SNAP_DELAY = 80;
  const MAX_SNAP_DELAY = 150;
  const SNAP_IMPULSE = 0.038;
  const TENSION_WOBBLE_FORCE = 0.00018;
  const TENSION_TORQUE = 0.0018;
  const REST_SPEED = 0.12;
  const REST_ANGULAR_SPEED = 0.012;
  const CLUSTER_GLOW_RADIUS = MAGNET_RADIUS * 2.9;
  const FRICTION = 0.9;
  const AIR_FRICTION = 0.18;
  const RESTITUTION = 0.2;
  const DENSITY = 0.02;
  const WALL_RESTITUTION = 0.18;
  const PLACE_CLEARANCE = MAGNET_RADIUS * 2 + 2;
  const BOUNDARY_MARGIN = MAGNET_RADIUS + 6;

  /* -- State ------------------------------------------------------------ */
  let canvas, ctx2d;
  let engine, world;
  let arenaCenter, arenaRadius;
  let magnets = [];
  let constraints = [];
  let lockedPairs = new Map();
  let snapTimers = new Map();
  let pairHumIds = new Set();
  let frameId = 0;
  let settleTimer = 0;
  let isSettling = false;
  let lastPlacedId = null;
  let replayBuffer = [];
  let totalChains = 0;
  let longestChain = 0;
  let totalTurns = 0;
  let gameMode = 'local';
  let practiceMode = false;
  let onSnapCallback = null;
  let onTurnEndCallback = null;
  let onGameOverCallback = null;
  let flashAlpha = 0;
  let shakeFrames = 0;
  let lastTickAt = 0;

  /* -- Init ------------------------------------------------------------- */
  function init(canvasEl, options = {}) {
    canvas = canvasEl;
    ctx2d = canvas.getContext('2d');
    gameMode = options.mode || 'local';
    practiceMode = gameMode === 'practice';

    onSnapCallback = options.onSnap || null;
    onTurnEndCallback = options.onTurnEnd || null;
    onGameOverCallback = options.onGameOver || null;

    resizeCanvas();

    engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 },
      enableSleeping: true
    });
    world = engine.world;

    buildArenaWalls();
    bindCollisionEvents();

    magnets = [];
    constraints = [];
    lockedPairs.clear();
    clearSnapTimers();
    clearPairHums();
    replayBuffer = [];
    totalChains = 0;
    longestChain = 0;
    totalTurns = 0;
    lastPlacedId = null;
    flashAlpha = 0;
    shakeFrames = 0;
    lastTickAt = 0;
    isSettling = false;
    settleTimer = 0;

    if (frameId) cancelAnimationFrame(frameId);
    loop();
  }

  function resizeCanvas() {
    const wrap = canvas?.parentElement;
    const wrapRect = wrap?.getBoundingClientRect();
    const fallbackHeight = Math.max(window.innerHeight - 80, 280);
    const size = Math.max(
      280,
      Math.min(wrapRect?.width || window.innerWidth, wrapRect?.height || fallbackHeight, 640)
    );
    canvas.width = size;
    canvas.height = size;
    arenaRadius = size * 0.44;
    arenaCenter = { x: size / 2, y: size / 2 };
  }

  function buildArenaWalls() {
    Matter.World.clear(world);
    Matter.Engine.clear(engine);

    const segments = 64;
    const wallThickness = 30;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;
      const x1 = arenaCenter.x + Math.cos(angle) * (arenaRadius + wallThickness / 2);
      const y1 = arenaCenter.y + Math.sin(angle) * (arenaRadius + wallThickness / 2);
      const x2 = arenaCenter.x + Math.cos(nextAngle) * (arenaRadius + wallThickness / 2);
      const y2 = arenaCenter.y + Math.sin(nextAngle) * (arenaRadius + wallThickness / 2);
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const wallAngle = Math.atan2(y2 - y1, x2 - x1);
      const wall = Matter.Bodies.rectangle(cx, cy, len + 2, wallThickness, {
        isStatic: true,
        angle: wallAngle,
        restitution: WALL_RESTITUTION,
        friction: 0.4,
        label: 'wall',
        collisionFilter: { category: 0x0002 }
      });
      Matter.World.add(world, wall);
    }
  }

  function bindCollisionEvents() {
    Matter.Events.off(engine, 'collisionStart');
    Matter.Events.on(engine, 'collisionStart', event => {
      for (const pair of event.pairs) {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;
        if (bodyA.label !== 'magnet' || bodyB.label !== 'magnet') continue;
        lockPair(bodyA, bodyB, 'collision');
      }
    });
  }

  /* -- Placement -------------------------------------------------------- */
  function validatePlacement(x, y) {
    const distFromCenter = Math.hypot(x - arenaCenter.x, y - arenaCenter.y);
    const maxR = arenaRadius - BOUNDARY_MARGIN;
    if (distFromCenter >= maxR) {
      return { valid: false, reason: 'Place fully inside the arena. Boundary contact is illegal.' };
    }

    for (const magnet of magnets) {
      const dist = Math.hypot(x - magnet.body.position.x, y - magnet.body.position.y);
      if (dist < PLACE_CLEARANCE) {
        return { valid: false, reason: 'Illegal move: magnets cannot overlap or touch during placement.' };
      }
    }

    return { valid: true };
  }

  function placeMagnet(x, y, playerId, magnetId) {
    const placement = applyPlacementInstability(x, y);
    const body = Matter.Bodies.circle(placement.x, placement.y, MAGNET_RADIUS, {
      restitution: RESTITUTION,
      friction: FRICTION,
      frictionAir: AIR_FRICTION,
      density: DENSITY,
      sleepThreshold: 25,
      label: 'magnet',
      collisionFilter: { category: 0x0001, mask: 0x0001 | 0x0002 }
    });

    body._magnetData = {
      id: magnetId,
      playerId,
      wobbleSeed: Math.random() * Math.PI * 2,
      zone: 'safe',
      tensionLevel: 0,
      lockedCount: 0
    };

    Matter.Body.setAngle(body, placement.angle);
    Matter.Body.setAngularVelocity(body, placement.angularVelocity);
    Matter.World.add(world, body);

    const entry = { body, playerId, id: magnetId };
    magnets.push(entry);
    lastPlacedId = magnetId;

    Matter.Sleeping.set(body, false);
    Matter.Body.applyForce(body, body.position, {
      x: placement.force.x,
      y: placement.force.y
    });

    startSettling();
    return body;
  }

  function applyPlacementInstability(x, y) {
    let angle = (Math.random() - 0.5) * 0.18;
    let angularVelocity = (Math.random() - 0.5) * 0.035;
    let force = {
      x: (Math.random() - 0.5) * 0.0018,
      y: (Math.random() - 0.5) * 0.0018
    };

    for (const other of magnets) {
      const dx = other.body.position.x - x;
      const dy = other.body.position.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > ACTIVATION_RADIUS || dist < 1) continue;

      const strength = dist <= SNAP_RADIUS
        ? 0.9
        : Math.max(0.15, 1 - (dist - SNAP_RADIUS) / (ACTIVATION_RADIUS - SNAP_RADIUS));
      const dirX = dx / dist;
      const dirY = dy / dist;
      force.x += dirX * 0.0015 * strength;
      force.y += dirY * 0.0015 * strength;
      angle += (Math.random() - 0.5) * 0.12 * strength;
      angularVelocity += (Math.random() - 0.5) * 0.03 * strength;
    }

    return { x, y, angle, angularVelocity, force };
  }

  function removeMagnet(id) {
    const idx = magnets.findIndex(m => m.id === id);
    if (idx === -1) return;

    const target = magnets[idx].body;
    removeConstraintsForBody(target);
    clearSnapTimersForBody(target);
    clearPairHumsForBody(target);

    Matter.World.remove(world, target);
    magnets.splice(idx, 1);
  }

  /* -- Magnetic Zones --------------------------------------------------- */
  function applyMagneticField() {
    const spatial = buildSpatialIndex();
    const candidatePairs = getCandidatePairs(spatial);
    const touchedHumIds = new Set();
    const touchedBodies = new Set();

    for (const [entryA, entryB] of candidatePairs) {
      const bodyA = entryA.body;
      const bodyB = entryB.body;
      const dx = bodyB.position.x - bodyA.position.x;
      const dy = bodyB.position.y - bodyA.position.y;
      const dist = Math.hypot(dx, dy);
      const key = getPairKey(bodyA, bodyB);
      const humId = `hum_${key}`;

      if (dist > ACTIVATION_RADIUS || dist <= 0.0001 || isLockedPair(bodyA, bodyB)) {
        cancelSnapTimer(key);
        AudioEngine.stopHum(humId);
        continue;
      }

      touchedHumIds.add(humId);
      touchedBodies.add(bodyA);
      touchedBodies.add(bodyB);

      if (dist > SNAP_RADIUS) {
        const closeness = 1 - (dist - SNAP_RADIUS) / (ACTIVATION_RADIUS - SNAP_RADIUS);
        const intensity = Math.max(0.08, Math.min(1, closeness));
        applyTension(bodyA, bodyB, dx / dist, dy / dist, intensity);
        AudioEngine.startHum(humId, 52 + intensity * 36, 0.008 + intensity * 0.035);
        AudioEngine.setHumVolume(humId, 0.008 + intensity * 0.035);
        if (Date.now() - lastTickAt > 120 && intensity > 0.82) {
          AudioEngine.playTick(0.12 + intensity * 0.18);
          lastTickAt = Date.now();
        }
      } else {
        AudioEngine.startHum(humId, 88, 0.05);
        AudioEngine.setHumVolume(humId, 0.05);
        scheduleSnap(bodyA, bodyB, key);
      }
    }

    for (const humId of pairHumIds) {
      if (!touchedHumIds.has(humId)) AudioEngine.stopHum(humId);
    }
    pairHumIds = touchedHumIds;

    for (const entry of magnets) {
      updateMagnetZone(entry.body, touchedBodies);
    }
  }

  function applyTension(bodyA, bodyB, dirX, dirY, intensity) {
    const wobbleA = ((Math.random() - 0.5) * TENSION_WOBBLE_FORCE) * intensity;
    const wobbleB = ((Math.random() - 0.5) * TENSION_WOBBLE_FORCE) * intensity;
    const lateralX = -dirY;
    const lateralY = dirX;

    Matter.Sleeping.set(bodyA, false);
    Matter.Sleeping.set(bodyB, false);

    Matter.Body.applyForce(bodyA, bodyA.position, {
      x: lateralX * wobbleA,
      y: lateralY * wobbleA
    });
    Matter.Body.applyForce(bodyB, bodyB.position, {
      x: -lateralX * wobbleB,
      y: -lateralY * wobbleB
    });

    bodyA.torque += (Math.random() - 0.5) * TENSION_TORQUE * intensity;
    bodyB.torque += (Math.random() - 0.5) * TENSION_TORQUE * intensity;
  }

  function updateMagnetZone(body, touchedBodies) {
    if (!body._magnetData) return;
    if (!touchedBodies.has(body)) {
      body._magnetData.zone = 'safe';
      body._magnetData.tensionLevel = 0;
      return;
    }

    const bodyLocks = countLocks(body);
    body._magnetData.lockedCount = bodyLocks;
    body._magnetData.zone = bodyLocks > 0 ? 'locked' : 'tension';
    body._magnetData.tensionLevel = Math.min(1, bodyLocks > 0 ? 0.8 : 0.45);
  }

  function scheduleSnap(bodyA, bodyB, key) {
    if (snapTimers.has(key) || isLockedPair(bodyA, bodyB)) return;
    const delay = MIN_SNAP_DELAY + Math.random() * (MAX_SNAP_DELAY - MIN_SNAP_DELAY);
    const timerId = setTimeout(() => {
      snapTimers.delete(key);
      const entryA = getMagnetByBodyId(bodyA.id);
      const entryB = getMagnetByBodyId(bodyB.id);
      if (!entryA || !entryB || isLockedPair(bodyA, bodyB)) return;

      const dx = bodyB.position.x - bodyA.position.x;
      const dy = bodyB.position.y - bodyA.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist > SNAP_RADIUS || dist <= 0.0001) return;

      triggerSnap(bodyA, bodyB, dx / dist, dy / dist, dist);
    }, delay);
    snapTimers.set(key, timerId);
  }

  function triggerSnap(bodyA, bodyB, dirX, dirY, dist) {
    const intensity = Math.max(0.85, 1 + (SNAP_RADIUS - dist) / SNAP_RADIUS);
    const impulse = SNAP_IMPULSE * intensity;

    Matter.Sleeping.set(bodyA, false);
    Matter.Sleeping.set(bodyB, false);

    Matter.Body.applyForce(bodyA, bodyA.position, { x: dirX * impulse, y: dirY * impulse });
    Matter.Body.applyForce(bodyB, bodyB.position, { x: -dirX * impulse, y: -dirY * impulse });

    bodyA.torque += (Math.random() - 0.5) * 0.01;
    bodyB.torque += (Math.random() - 0.5) * 0.01;

    flashAlpha = Math.max(flashAlpha, 0.4);
    shakeFrames = Math.max(shakeFrames, 8);
    AudioEngine.playSnap(0.8 + Math.min(0.5, intensity * 0.25));

    startSettling();
  }

  /* -- Constraints and Clusters ---------------------------------------- */
  function lockPair(bodyA, bodyB, reason = 'collision') {
    if (isLockedPair(bodyA, bodyB)) return false;

    const dx = bodyB.position.x - bodyA.position.x;
    const dy = bodyB.position.y - bodyA.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist > LOCK_DISTANCE) return false;

    const constraint = Matter.Constraint.create({
      bodyA,
      bodyB,
      stiffness: 1,
      damping: 0.3,
      length: 0,
      label: 'magnet-lock'
    });

    Matter.World.add(world, constraint);
    constraints.push(constraint);
    lockedPairs.set(getPairKey(bodyA, bodyB), constraint);

    bodyA.restitution = 0.02;
    bodyB.restitution = 0.02;
    bodyA._magnetData.lockedCount = countLocks(bodyA);
    bodyB._magnetData.lockedCount = countLocks(bodyB);
    bodyA._magnetData.zone = 'locked';
    bodyB._magnetData.zone = 'locked';

    AudioEngine.playImpact(reason === 'collision' ? 0.55 : 0.4);
    flashAlpha = Math.max(flashAlpha, 0.28);
    shakeFrames = Math.max(shakeFrames, 6);
    startSettling();
    return true;
  }

  function getConnectedMagnetIds() {
    const adjacency = new Map();
    for (const magnet of magnets) adjacency.set(magnet.id, new Set());

    for (const constraint of constraints) {
      const entryA = getMagnetByBodyId(constraint.bodyA.id);
      const entryB = getMagnetByBodyId(constraint.bodyB.id);
      if (!entryA || !entryB) continue;
      adjacency.get(entryA.id).add(entryB.id);
      adjacency.get(entryB.id).add(entryA.id);
    }

    const visited = new Set();
    const groups = [];
    for (const magnet of magnets) {
      if (visited.has(magnet.id)) continue;
      const queue = [magnet.id];
      const group = [];

      while (queue.length) {
        const id = queue.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        group.push(id);
        for (const next of adjacency.get(id) || []) {
          if (!visited.has(next)) queue.push(next);
        }
      }

      if (group.length > 1) groups.push(group);
    }

    return groups;
  }

  /* -- Physics Loop ----------------------------------------------------- */
  function loop() {
    applyMagneticField();
    Matter.Engine.update(engine, 1000 / 60);
    constrainToArena();
    dampSleepingBodies();

    if (isSettling) {
      replayBuffer.push(magnets.map(m => ({
        id: m.id,
        x: m.body.position.x,
        y: m.body.position.y,
        angle: m.body.angle
      })));
    }

    if (isSettling && settleTimer > 0) {
      settleTimer--;
      if (isSettled() || settleTimer <= 0) {
        isSettling = false;
        handleSettled();
      }
    }

    draw();
    flashAlpha *= 0.88;
    if (shakeFrames > 0) shakeFrames--;
    frameId = requestAnimationFrame(loop);
  }

  function constrainToArena() {
    for (const magnet of magnets) {
      const body = magnet.body;
      const dx = body.position.x - arenaCenter.x;
      const dy = body.position.y - arenaCenter.y;
      const dist = Math.hypot(dx, dy);
      const maxR = arenaRadius - MAGNET_RADIUS;
      if (dist > maxR) {
        const ratio = maxR / dist;
        Matter.Body.setPosition(body, {
          x: arenaCenter.x + dx * ratio,
          y: arenaCenter.y + dy * ratio
        });

        const speed = Math.hypot(body.velocity.x, body.velocity.y);
        const nx = dx / dist;
        const ny = dy / dist;
        const dot = body.velocity.x * nx + body.velocity.y * ny;
        Matter.Body.setVelocity(body, {
          x: (body.velocity.x - 2 * dot * nx) * WALL_RESTITUTION,
          y: (body.velocity.y - 2 * dot * ny) * WALL_RESTITUTION
        });
        if (speed > 0.2) AudioEngine.playBoundaryHit(Math.min(speed / 3, 1));
      }
    }
  }

  function dampSleepingBodies() {
    for (const magnet of magnets) {
      const body = magnet.body;
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      const angularSpeed = Math.abs(body.angularVelocity);
      if (speed < REST_SPEED && angularSpeed < REST_ANGULAR_SPEED) {
        Matter.Body.setVelocity(body, { x: body.velocity.x * 0.72, y: body.velocity.y * 0.72 });
        Matter.Body.setAngularVelocity(body, body.angularVelocity * 0.68);
      }
    }
  }

  function isSettled() {
    for (const magnet of magnets) {
      const body = magnet.body;
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      const angularSpeed = Math.abs(body.angularVelocity);
      if (speed > REST_SPEED || angularSpeed > REST_ANGULAR_SPEED) return false;
    }
    return true;
  }

  function handleSettled() {
    if (practiceMode) return;

    const groups = getConnectedMagnetIds();
    const chainCount = groups.reduce((total, group) => total + group.length, 0);

    if (chainCount > 0) {
      totalChains++;
      if (chainCount > longestChain) longestChain = chainCount;

      const lastMagnet = magnets.find(m => m.id === lastPlacedId);
      const culpritPlayer = lastMagnet ? lastMagnet.playerId : 1;
      const connectedIds = groups.flat();

      AudioEngine.playChainReaction(Math.min(chainCount, 8));
      flashAlpha = Math.max(flashAlpha, 0.45);
      shakeFrames = Math.max(shakeFrames, 16);

      if (onSnapCallback) {
        onSnapCallback({
          culpritPlayer,
          connectedIds,
          chainCount
        });
      }
      return;
    }

    totalTurns++;
    AudioEngine.playTurnChime();
    if (onTurnEndCallback) onTurnEndCallback({ clean: true });
  }

  function startSettling() {
    isSettling = true;
    settleTimer = SETTLE_FRAMES;
    replayBuffer = [];
  }

  /* -- Replay ----------------------------------------------------------- */
  async function playReplay() {
    const snapshots = [...replayBuffer];
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < snapshots.length; i++) {
      for (const entry of snapshots[i]) {
        const magnet = magnets.find(m => m.id === entry.id);
        if (!magnet) continue;
        Matter.Body.setPosition(magnet.body, { x: entry.x, y: entry.y });
        Matter.Body.setAngle(magnet.body, entry.angle);
      }
      draw();
      if (i % 2 === 0) await delay(40);
    }
  }

  /* -- Drawing ---------------------------------------------------------- */
  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);

    const shakeX = shakeFrames > 0 ? (Math.random() - 0.5) * shakeFrames * 1.1 : 0;
    const shakeY = shakeFrames > 0 ? (Math.random() - 0.5) * shakeFrames * 1.1 : 0;

    ctx2d.save();
    ctx2d.translate(shakeX, shakeY);

    drawBackground(w, h);
    drawArena();
    drawFieldLines();
    drawLocks();
    for (const magnet of magnets) drawMagnet(magnet);
    drawAttractionZones();

    ctx2d.restore();
    drawFlashOverlay(w, h);
  }

  function drawBackground(w, h) {
    const bg = ctx2d.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    bg.addColorStop(0, '#0f1522');
    bg.addColorStop(1, '#070b12');
    ctx2d.fillStyle = bg;
    ctx2d.fillRect(0, 0, w, h);
  }

  function drawArena() {
    for (let i = 3; i >= 1; i--) {
      ctx2d.beginPath();
      ctx2d.arc(arenaCenter.x, arenaCenter.y, arenaRadius + i * 7, 0, Math.PI * 2);
      ctx2d.strokeStyle = `rgba(110, 231, 255, ${0.018 * i})`;
      ctx2d.lineWidth = 6;
      ctx2d.stroke();
    }

    const arenaGrad = ctx2d.createRadialGradient(
      arenaCenter.x, arenaCenter.y, 0,
      arenaCenter.x, arenaCenter.y, arenaRadius
    );
    arenaGrad.addColorStop(0, 'rgba(26, 33, 46, 0.95)');
    arenaGrad.addColorStop(1, 'rgba(10, 12, 19, 0.98)');
    ctx2d.beginPath();
    ctx2d.arc(arenaCenter.x, arenaCenter.y, arenaRadius, 0, Math.PI * 2);
    ctx2d.fillStyle = arenaGrad;
    ctx2d.fill();

    ctx2d.beginPath();
    ctx2d.arc(arenaCenter.x, arenaCenter.y, arenaRadius, 0, Math.PI * 2);
    ctx2d.strokeStyle = 'rgba(230, 242, 255, 0.22)';
    ctx2d.lineWidth = 2;
    ctx2d.stroke();
  }

  function drawFieldLines() {
    if (magnets.length < 2) return;
    const candidatePairs = getCandidatePairs(buildSpatialIndex());

    ctx2d.save();
    for (const [entryA, entryB] of candidatePairs) {
      const a = entryA.body.position;
      const b = entryB.body.position;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist > ACTIVATION_RADIUS) continue;

      const alpha = dist <= SNAP_RADIUS
        ? 0.32
        : 0.05 + 0.12 * (1 - (dist - SNAP_RADIUS) / (ACTIVATION_RADIUS - SNAP_RADIUS));
      ctx2d.globalAlpha = alpha;
      ctx2d.beginPath();
      ctx2d.moveTo(a.x, a.y);
      const mx = (a.x + b.x) / 2 + (a.y - b.y) * 0.08;
      const my = (a.y + b.y) / 2 - (a.x - b.x) * 0.08;
      ctx2d.quadraticCurveTo(mx, my, b.x, b.y);
      ctx2d.strokeStyle = dist <= SNAP_RADIUS ? '#f8fafc' : '#8be9fd';
      ctx2d.lineWidth = dist <= SNAP_RADIUS ? 2.5 : 1;
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawLocks() {
    ctx2d.save();
    ctx2d.globalAlpha = 0.35;
    for (const constraint of constraints) {
      const a = constraint.bodyA.position;
      const b = constraint.bodyB.position;
      ctx2d.beginPath();
      ctx2d.moveTo(a.x, a.y);
      ctx2d.lineTo(b.x, b.y);
      ctx2d.strokeStyle = 'rgba(255,255,255,0.26)';
      ctx2d.lineWidth = 3;
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawAttractionZones() {
    for (const magnet of magnets) {
      const body = magnet.body;
      const zone = body._magnetData.zone;
      if (zone === 'safe') continue;

      const pulse = 0.65 + 0.35 * Math.sin(Date.now() / 150 + body.id);
      ctx2d.save();
      ctx2d.beginPath();
      ctx2d.arc(body.position.x, body.position.y, zone === 'locked' ? SNAP_RADIUS * 0.65 : SNAP_RADIUS, 0, Math.PI * 2);
      ctx2d.strokeStyle = zone === 'locked'
        ? `rgba(255, 244, 214, ${0.18 + pulse * 0.08})`
        : `rgba(139, 233, 253, ${0.08 + pulse * 0.08})`;
      ctx2d.lineWidth = zone === 'locked' ? 2.4 : 1.2;
      ctx2d.stroke();
      ctx2d.restore();
    }
  }

  function drawMagnet(magnet) {
    const body = magnet.body;
    const data = body._magnetData;
    const time = Date.now() / 1000;
    const baseX = body.position.x;
    const baseY = body.position.y;
    const tensionOffset = data.zone === 'tension'
      ? Math.sin(time * 42 + data.wobbleSeed) * 0.7 * Math.max(0.25, data.tensionLevel)
      : 0;
    const angleJitter = data.zone === 'tension'
      ? Math.sin(time * 30 + data.wobbleSeed) * 0.025 * Math.max(0.4, data.tensionLevel)
      : 0;
    const x = baseX + tensionOffset;
    const y = baseY - tensionOffset * 0.6;
    const angle = body.angle + angleJitter;
    const color = magnet.playerId === 1 ? '#f472b6' : '#22d3ee';
    const colorDark = magnet.playerId === 1 ? '#be185d' : '#0f766e';

    ctx2d.save();
    ctx2d.translate(x, y);
    ctx2d.rotate(angle);

    const glowRadius = data.zone === 'locked'
      ? CLUSTER_GLOW_RADIUS + Math.min(10, data.lockedCount * 2)
      : data.zone === 'tension'
        ? MAGNET_RADIUS * 2.7
        : MAGNET_RADIUS * 2.1;
    const glowAlpha = data.zone === 'locked'
      ? 0.34
      : data.zone === 'tension'
        ? 0.22
        : 0.12;

    const glowGrad = ctx2d.createRadialGradient(0, 0, MAGNET_RADIUS * 0.4, 0, 0, glowRadius);
    glowGrad.addColorStop(0, `${color}66`);
    glowGrad.addColorStop(1, 'transparent');
    ctx2d.beginPath();
    ctx2d.arc(0, 0, glowRadius, 0, Math.PI * 2);
    ctx2d.fillStyle = glowGrad;
    ctx2d.globalAlpha = glowAlpha;
    ctx2d.fill();
    ctx2d.globalAlpha = 1;

    ctx2d.shadowColor = color;
    ctx2d.shadowBlur = data.zone === 'locked' ? 16 : 10;

    const bodyGrad = ctx2d.createRadialGradient(-MAGNET_RADIUS * 0.3, -MAGNET_RADIUS * 0.3, 1, 0, 0, MAGNET_RADIUS);
    bodyGrad.addColorStop(0, '#ffffff33');
    bodyGrad.addColorStop(0.42, color);
    bodyGrad.addColorStop(1, colorDark);
    ctx2d.beginPath();
    ctx2d.arc(0, 0, MAGNET_RADIUS, 0, Math.PI * 2);
    ctx2d.fillStyle = bodyGrad;
    ctx2d.fill();

    ctx2d.shadowBlur = 0;
    ctx2d.beginPath();
    ctx2d.arc(-MAGNET_RADIUS * 0.28, -MAGNET_RADIUS * 0.28, MAGNET_RADIUS * 0.35, 0, Math.PI * 2);
    ctx2d.fillStyle = 'rgba(255,255,255,0.35)';
    ctx2d.fill();

    ctx2d.beginPath();
    ctx2d.arc(0, 0, MAGNET_RADIUS, 0, Math.PI * 2);
    ctx2d.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx2d.lineWidth = 1.5;
    ctx2d.stroke();

    if (magnet.id === lastPlacedId && isSettling) {
      const pulse = Math.sin(time * 9) * 0.5 + 0.5;
      ctx2d.beginPath();
      ctx2d.arc(0, 0, MAGNET_RADIUS + 7 + pulse * 3, 0, Math.PI * 2);
      ctx2d.strokeStyle = `rgba(251, 191, 36, ${0.25 + pulse * 0.35})`;
      ctx2d.lineWidth = 2;
      ctx2d.stroke();
    }

    ctx2d.restore();
  }

  function drawFlashOverlay(w, h) {
    if (flashAlpha <= 0.01) return;
    ctx2d.save();
    ctx2d.fillStyle = `rgba(255,255,255,${Math.min(0.4, flashAlpha)})`;
    ctx2d.fillRect(0, 0, w, h);
    ctx2d.restore();
  }

  /* -- Helpers ---------------------------------------------------------- */
  function buildSpatialIndex() {
    const grid = new Map();
    for (const entry of magnets) {
      const cx = Math.floor(entry.body.position.x / GRID_SIZE);
      const cy = Math.floor(entry.body.position.y / GRID_SIZE);
      const key = `${cx},${cy}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(entry);
    }
    return grid;
  }

  function getCandidatePairs(grid) {
    const pairs = [];
    const pairKeys = new Set();
    for (const [cellKey, entries] of grid.entries()) {
      const [cx, cy] = cellKey.split(',').map(Number);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const neighbor = grid.get(`${cx + ox},${cy + oy}`);
          if (!neighbor) continue;
          for (const a of entries) {
            for (const b of neighbor) {
              if (a.id >= b.id) continue;
              const key = `${a.id}:${b.id}`;
              if (pairKeys.has(key)) continue;
              pairKeys.add(key);
              pairs.push([a, b]);
            }
          }
        }
      }
    }
    return pairs;
  }

  function getPairKey(bodyA, bodyB) {
    return bodyA.id < bodyB.id ? `${bodyA.id}:${bodyB.id}` : `${bodyB.id}:${bodyA.id}`;
  }

  function getMagnetByBodyId(bodyId) {
    return magnets.find(m => m.body.id === bodyId) || null;
  }

  function isLockedPair(bodyA, bodyB) {
    return lockedPairs.has(getPairKey(bodyA, bodyB));
  }

  function countLocks(body) {
    let count = 0;
    for (const constraint of constraints) {
      if (constraint.bodyA === body || constraint.bodyB === body) count++;
    }
    return count;
  }

  function removeConstraintsForBody(body) {
    const retained = [];
    for (const constraint of constraints) {
      const involvesBody = constraint.bodyA === body || constraint.bodyB === body;
      if (involvesBody) {
        Matter.World.remove(world, constraint);
        lockedPairs.delete(getPairKey(constraint.bodyA, constraint.bodyB));
      } else {
        retained.push(constraint);
      }
    }
    constraints = retained;
  }

  function cancelSnapTimer(key) {
    const timerId = snapTimers.get(key);
    if (!timerId) return;
    clearTimeout(timerId);
    snapTimers.delete(key);
  }

  function clearSnapTimersForBody(body) {
    for (const key of [...snapTimers.keys()]) {
      if (key.startsWith(`${body.id}:`) || key.endsWith(`:${body.id}`)) {
        cancelSnapTimer(key);
      }
    }
  }

  function clearSnapTimers() {
    for (const timerId of snapTimers.values()) clearTimeout(timerId);
    snapTimers.clear();
  }

  function clearPairHumsForBody(body) {
    for (const humId of [...pairHumIds]) {
      if (humId.includes(`_${body.id}:`) || humId.endsWith(`:${body.id}`)) {
        AudioEngine.stopHum(humId);
        pairHumIds.delete(humId);
      }
    }
  }

  function clearPairHums() {
    for (const humId of pairHumIds) AudioEngine.stopHum(humId);
    pairHumIds.clear();
  }

  /* -- Public API ------------------------------------------------------- */
  function getArenaCenter() { return { ...arenaCenter }; }
  function getArenaRadius() { return arenaRadius; }
  function getMagnets() { return magnets; }
  function getStats() { return { totalChains, longestChain, totalTurns }; }
  function destroy() {
    if (frameId) cancelAnimationFrame(frameId);
    clearSnapTimers();
    clearPairHums();
    AudioEngine.stopAllHums();
    if (world) {
      Matter.World.clear(world);
      Matter.Engine.clear(engine);
    }
  }
  function setLastPlaced(id) { lastPlacedId = id; }
  function getReplayBuffer() { return replayBuffer; }
  function getPracticeMode() { return practiceMode; }

  return {
    init,
    validatePlacement,
    placeMagnet,
    removeMagnet,
    getArenaCenter,
    getArenaRadius,
    getMagnets,
    getStats,
    resizeCanvas,
    destroy,
    playReplay,
    setLastPlaced,
    getReplayBuffer,
    getPracticeMode,
    get canvas() { return canvas; }
  };
})();
