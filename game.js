/**
 * game.js — Core physics & rendering engine
 * Uses Matter.js for rigid-body physics, custom magnetic force layer.
 */

const Game = (() => {
  /* ── Constants ─────────────────────────────────────────── */
  const MAGNET_RADIUS   = 14;          // px visual radius
  const SNAP_DISTANCE   = MAGNET_RADIUS * 2.2;  // connect/click threshold
  const ATTRACT_RADIUS  = MAGNET_RADIUS * 12;   // Attract up to distance shown in image
  const MAGNET_STRENGTH = 0.0006;                // stronger for cross-arena pull
  const FRICTION        = 0.06;
  const AIR_FRICTION    = 0.04;
  const WALL_RESTITUTION = 0.3;
  const SETTLE_FRAMES   = 80;          // frames to wait for settling

  /* ── State ─────────────────────────────────────────────── */
  let canvas, ctx2d;
  let engine, world, render; // Matter.js
  let arenaCenter, arenaRadius;
  let magnets = [];          // [{body, playerId, id, connected}]
  let connectedGroups = [];  // [[body, body, ...]]
  let frameId;
  let settleTimer = 0;
  let isSettling = false;
  let lastPlacedId = null;
  let replayBuffer = [];     // [{positions snapshot}]
  let chainCount = 0;
  let totalChains = 0;
  let longestChain = 0;
  let totalTurns = 0;
  let gameMode = 'local';    // 'local' | 'online' | 'practice'
  let onSnapCallback = null;
  let onTurnEndCallback = null;
  let onGameOverCallback = null;
  let practiceMode = false;

  /* ── Init ──────────────────────────────────────────────── */
  function init(canvasEl, options = {}) {
    canvas = canvasEl;
    ctx2d = canvas.getContext('2d');
    gameMode = options.mode || 'local';
    practiceMode = gameMode === 'practice';

    onSnapCallback    = options.onSnap    || null;
    onTurnEndCallback = options.onTurnEnd || null;
    onGameOverCallback= options.onGameOver|| null;

    resizeCanvas();

    // Matter.js engine
    engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
    world  = engine.world;

    // Arena boundary walls (circular via many segments)
    buildArenaWalls();

    // Reset state
    magnets = [];
    connectedGroups = [];
    replayBuffer = [];
    chainCount = 0;
    totalChains = 0;
    longestChain = 0;
    totalTurns = 0;
    lastPlacedId = null;

    if (frameId) cancelAnimationFrame(frameId);
    loop();
  }

  function resizeCanvas() {
    const size = Math.min(window.innerWidth, window.innerHeight - 80, 640);
    canvas.width  = size;
    canvas.height = size;
    arenaRadius = size * 0.44;
    arenaCenter = { x: size / 2, y: size / 2 };
  }

  /* ── Arena walls (polygon approximation of circle) ─────── */
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
        friction: 0.1,
        label: 'wall',
        collisionFilter: { category: 0x0002 }
      });
      Matter.World.add(world, wall);
    }
  }

  /* ── Place magnet ──────────────────────────────────────── */
  function placeMagnet(x, y, playerId, magnetId) {
    // Clamp inside arena
    const dx = x - arenaCenter.x;
    const dy = y - arenaCenter.y;
    const dist = Math.hypot(dx, dy);
    const maxR = arenaRadius - MAGNET_RADIUS - 5;
    if (dist > maxR) {
      const ratio = maxR / dist;
      x = arenaCenter.x + dx * ratio;
      y = arenaCenter.y + dy * ratio;
    }

    const body = Matter.Bodies.circle(x, y, MAGNET_RADIUS, {
      restitution: 0.4,
      friction: FRICTION,
      frictionAir: AIR_FRICTION,
      mass: 1,
      label: 'magnet',
      collisionFilter: { category: 0x0001, mask: 0x0001 | 0x0002 }
    });

    body._magnetData = {
      id: magnetId,
      playerId,
      connected: false,
      wobble: Math.random() * Math.PI * 2,
      trailPositions: []
    };

    Matter.World.add(world, body);
    const entry = { body, playerId, id: magnetId };
    magnets.push(entry);
    lastPlacedId = magnetId;

    // Add slight random impulse for feel
    Matter.Body.applyForce(body, body.position, {
      x: (Math.random() - 0.5) * 0.002,
      y: (Math.random() - 0.5) * 0.002
    });

    // Start settling check
    isSettling = true;
    settleTimer = SETTLE_FRAMES;
    replayBuffer = [];

    return body;
  }

  /* ── Remove magnet ─────────────────────────────────────── */
  function removeMagnet(id) {
    const idx = magnets.findIndex(m => m.id === id);
    if (idx === -1) return;
    Matter.World.remove(world, magnets[idx].body);
    magnets.splice(idx, 1);
  }

  /* ── Magnetic force each frame ─────────────────────────── */
  function applyMagneticForces() {
    for (let i = 0; i < magnets.length; i++) {
      for (let j = i + 1; j < magnets.length; j++) {
        const a = magnets[i].body;
        const b = magnets[j].body;
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq);

        if (dist < ATTRACT_RADIUS && dist > 0.1) {
          // Inverse-square attraction
          const forceMag = MAGNET_STRENGTH / Math.max(distSq, 400);
          const fx = (dx / dist) * forceMag;
          const fy = (dy / dist) * forceMag;
          if (!a.isStatic) Matter.Body.applyForce(a, a.position, { x: fx, y: fy });
          if (!b.isStatic) Matter.Body.applyForce(b, b.position, { x: -fx, y: -fy });

          // Hum volume based on distance vs arena radius (not ATTRACT_RADIUS)
          const proximityRatio = Math.max(0, 1 - dist / (arenaRadius * 2));
          const vol = proximityRatio * proximityRatio * 0.07;
          if (vol > 0.004) {
            AudioEngine.startHum(`hum_${i}_${j}`, 55 + proximityRatio * 90, vol);
            AudioEngine.setHumVolume(`hum_${i}_${j}`, vol);
          } else {
            AudioEngine.stopHum(`hum_${i}_${j}`);
          }
        }
      }
    }
  }

  /* ── Constrain magnets inside arena ────────────────────── */
  function constrainToArena() {
    for (const m of magnets) {
      const b = m.body;
      const dx = b.position.x - arenaCenter.x;
      const dy = b.position.y - arenaCenter.y;
      const dist = Math.hypot(dx, dy);
      const maxR = arenaRadius - MAGNET_RADIUS;
      if (dist > maxR) {
        const ratio = maxR / dist;
        Matter.Body.setPosition(b, {
          x: arenaCenter.x + dx * ratio,
          y: arenaCenter.y + dy * ratio
        });
        // Reflect velocity
        const speed = Math.hypot(b.velocity.x, b.velocity.y);
        const nx = dx / dist, ny = dy / dist;
        const dot = b.velocity.x * nx + b.velocity.y * ny;
        Matter.Body.setVelocity(b, {
          x: (b.velocity.x - 2 * dot * nx) * WALL_RESTITUTION,
          y: (b.velocity.y - 2 * dot * ny) * WALL_RESTITUTION
        });
        if (speed > 0.5) AudioEngine.playBoundaryHit(Math.min(speed / 5, 1));
      }
    }
  }

  /* ── Snap detection ────────────────────────────────────── */
  function checkSnaps() {
    const newGroups = [];
    const visited = new Set();

    function floodFill(startBody) {
      const group = [];
      const queue = [startBody];
      while (queue.length) {
        const current = queue.pop();
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        group.push(current);
        for (const other of magnets.map(m => m.body)) {
          if (!visited.has(other.id)) {
            const d = Math.hypot(
              other.position.x - current.position.x,
              other.position.y - current.position.y
            );
            if (d < SNAP_DISTANCE) queue.push(other);
          }
        }
      }
      return group;
    }

    for (const m of magnets) {
      if (!visited.has(m.body.id)) {
        const group = floodFill(m.body);
        if (group.length > 1) newGroups.push(group);
      }
    }

    return newGroups;
  }

  /* ── Check if physics settled ───────────────────────────── */
  function isSettled() {
    for (const m of magnets) {
      const b = m.body;
      const speed = Math.hypot(b.velocity.x, b.velocity.y);
      if (speed > 0.3) return false;
    }
    return true;
  }

  /* ── Game loop ──────────────────────────────────────────── */
  function loop() {
    Matter.Engine.update(engine, 1000 / 60);
    applyMagneticForces();
    constrainToArena();

    // Record replay
    if (isSettling) {
      replayBuffer.push(magnets.map(m => ({
        id: m.id, x: m.body.position.x, y: m.body.position.y,
        angle: m.body.angle
      })));
    }

    // Settle detection
    if (isSettling && settleTimer > 0) {
      settleTimer--;
      if (isSettled() || settleTimer <= 0) {
        isSettling = false;
        handleSettled();
      }
    }

    draw();
    frameId = requestAnimationFrame(loop);
  }

  /* ── Handle settled state ───────────────────────────────── */
  function handleSettled() {
    if (practiceMode) return;

    const groups = checkSnaps();
    chainCount = groups.reduce((acc, g) => acc + g.length, 0);

    if (chainCount > 0) {
      // Snap happened
      totalChains++;
      if (chainCount > longestChain) longestChain = chainCount;

      // Find which player placed the last magnet
      const lastMagnet = magnets.find(m => m.id === lastPlacedId);
      const culpritPlayer = lastMagnet ? lastMagnet.playerId : 1;

      // Collect: all connected magnets return to the player who triggered
      const connectedIds = groups.flatMap(g =>
        g.map(b => {
          const mEntry = magnets.find(m => m.body.id === b.id);
          return mEntry ? mEntry.id : null;
        }).filter(Boolean)
      );

      // Animate snap
      if (chainCount >= 2) {
        AudioEngine.playChainReaction(Math.min(chainCount, 6));
      } else {
        AudioEngine.playSnap(0.9);
      }

      if (onSnapCallback) {
        onSnapCallback({
          culpritPlayer,
          connectedIds,
          chainCount
        });
      }
    } else {
      // Clean placement
      totalTurns++;
      AudioEngine.playTurnChime();
      if (onTurnEndCallback) onTurnEndCallback({ clean: true });
    }
  }

  /* ── Replay slow motion ─────────────────────────────────── */
  async function playReplay() {
    const snapshots = [...replayBuffer];
    const delay = ms => new Promise(r => setTimeout(r, ms));

    for (let i = 0; i < snapshots.length; i++) {
      const frame = snapshots[i];
      for (const entry of frame) {
        const m = magnets.find(m => m.id === entry.id);
        if (m) {
          Matter.Body.setPosition(m.body, { x: entry.x, y: entry.y });
          Matter.Body.setAngle(m.body, entry.angle);
        }
      }
      draw();
      if (i % 2 === 0) await delay(40); // 2x slow
    }
  }

  /* ── Drawing ────────────────────────────────────────────── */
  function draw() {
    const w = canvas.width, h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);

    // Background
    const bg = ctx2d.createRadialGradient(w/2, h/2, 0, w/2, h/2, w/2);
    bg.addColorStop(0, '#0d0d20');
    bg.addColorStop(1, '#08080f');
    ctx2d.fillStyle = bg;
    ctx2d.fillRect(0, 0, w, h);

    // Arena glow
    drawArena();

    // Magnetic field lines
    drawFieldLines();

    // Magnets
    for (const m of magnets) {
      drawMagnet(m);
    }

    // Snap distance preview highlight
    drawAttractionZones();
  }

  function drawArena() {
    // Outer glow rings
    for (let i = 3; i >= 1; i--) {
      ctx2d.beginPath();
      ctx2d.arc(arenaCenter.x, arenaCenter.y, arenaRadius + i * 8, 0, Math.PI * 2);
      ctx2d.strokeStyle = `rgba(168,85,247,${0.04 * i})`;
      ctx2d.lineWidth = 6;
      ctx2d.stroke();
    }

    // Arena fill
    const arenaGrad = ctx2d.createRadialGradient(
      arenaCenter.x, arenaCenter.y, 0,
      arenaCenter.x, arenaCenter.y, arenaRadius
    );
    arenaGrad.addColorStop(0, 'rgba(20,18,40,0.92)');
    arenaGrad.addColorStop(1, 'rgba(10,8,25,0.98)');
    ctx2d.beginPath();
    ctx2d.arc(arenaCenter.x, arenaCenter.y, arenaRadius, 0, Math.PI * 2);
    ctx2d.fillStyle = arenaGrad;
    ctx2d.fill();

    // Arena border
    ctx2d.beginPath();
    ctx2d.arc(arenaCenter.x, arenaCenter.y, arenaRadius, 0, Math.PI * 2);
    ctx2d.strokeStyle = 'rgba(168,85,247,0.55)';
    ctx2d.lineWidth = 2.5;
    ctx2d.stroke();

    // Center cross
    ctx2d.save();
    ctx2d.globalAlpha = 0.06;
    ctx2d.strokeStyle = '#a78bfa';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(arenaCenter.x - arenaRadius, arenaCenter.y);
    ctx2d.lineTo(arenaCenter.x + arenaRadius, arenaCenter.y);
    ctx2d.moveTo(arenaCenter.x, arenaCenter.y - arenaRadius);
    ctx2d.lineTo(arenaCenter.x, arenaCenter.y + arenaRadius);
    ctx2d.stroke();
    ctx2d.restore();
  }

  function drawFieldLines() {
    if (magnets.length < 2) return;
    // Reference distance for alpha: full arena diameter
    const refDist = arenaRadius * 2;
    ctx2d.save();
    for (let i = 0; i < magnets.length; i++) {
      for (let j = i + 1; j < magnets.length; j++) {
        const a = magnets[i].body.position;
        const b = magnets[j].body.position;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        
        if (dist < ATTRACT_RADIUS) {
          // Alpha: closer = brighter, but always visible (min 0.08)
          const alpha = Math.max(0.08, 0.55 * Math.pow(1 - dist / refDist, 1.5));
          ctx2d.globalAlpha = alpha;
          ctx2d.beginPath();
          ctx2d.moveTo(a.x, a.y);
          // Curved field line
          const mx = (a.x + b.x) / 2 + (a.y - b.y) * 0.12;
          const my = (a.y + b.y) / 2 - (a.x - b.x) * 0.12;
          ctx2d.quadraticCurveTo(mx, my, b.x, b.y);
          // Hot pink when close to snapping, purple otherwise
          ctx2d.strokeStyle = dist < SNAP_DISTANCE * 3 ? '#e879f9' : '#a78bfa';
          ctx2d.lineWidth = dist < SNAP_DISTANCE * 2 ? 2 : 1;
          ctx2d.stroke();
        }
      }
    }
    ctx2d.restore();
  }

  function drawAttractionZones() {
    const time = Date.now() / 1000;
    for (const m of magnets) {
      const b = m.body;
      // Pulsing attraction radius ring
      ctx2d.save();
      const pulse = 0.5 + 0.5 * Math.sin(time * 2 + m.body.id);
      ctx2d.globalAlpha = 0.04 * pulse;
      ctx2d.beginPath();
      ctx2d.arc(b.position.x, b.position.y, ATTRACT_RADIUS, 0, Math.PI * 2);
      const color = m.playerId === 1 ? '#e879f9' : '#22d3ee';
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
      ctx2d.restore();
    }
  }

  function drawMagnet(m) {
    const b = m.body;
    const x = b.position.x, y = b.position.y;
    const angle = b.angle;
    const time = Date.now() / 1000;
    const color = m.playerId === 1 ? '#e879f9' : '#22d3ee';
    const colorDark = m.playerId === 1 ? '#9333ea' : '#0891b2';

    ctx2d.save();
    ctx2d.translate(x, y);
    ctx2d.rotate(angle);

    // Outer glow
    const glowGrad = ctx2d.createRadialGradient(0, 0, MAGNET_RADIUS * 0.5, 0, 0, MAGNET_RADIUS * 2.5);
    glowGrad.addColorStop(0, color + '55');
    glowGrad.addColorStop(1, 'transparent');
    ctx2d.beginPath();
    ctx2d.arc(0, 0, MAGNET_RADIUS * 2.5, 0, Math.PI * 2);
    ctx2d.fillStyle = glowGrad;
    ctx2d.fill();

    // Shadow
    ctx2d.shadowColor = color;
    ctx2d.shadowBlur = 12;

    // Main body gradient
    const bodyGrad = ctx2d.createRadialGradient(-MAGNET_RADIUS * 0.3, -MAGNET_RADIUS * 0.3, 1, 0, 0, MAGNET_RADIUS);
    bodyGrad.addColorStop(0, '#ffffff33');
    bodyGrad.addColorStop(0.4, color);
    bodyGrad.addColorStop(1, colorDark);
    ctx2d.beginPath();
    ctx2d.arc(0, 0, MAGNET_RADIUS, 0, Math.PI * 2);
    ctx2d.fillStyle = bodyGrad;
    ctx2d.fill();

    // Highlight
    ctx2d.shadowBlur = 0;
    ctx2d.beginPath();
    ctx2d.arc(-MAGNET_RADIUS * 0.28, -MAGNET_RADIUS * 0.28, MAGNET_RADIUS * 0.35, 0, Math.PI * 2);
    ctx2d.fillStyle = 'rgba(255,255,255,0.35)';
    ctx2d.fill();

    // Border
    ctx2d.beginPath();
    ctx2d.arc(0, 0, MAGNET_RADIUS, 0, Math.PI * 2);
    ctx2d.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx2d.lineWidth = 1.5;
    ctx2d.stroke();

    ctx2d.restore();

    // "New" pulse ring for last placed
    if (m.id === lastPlacedId && isSettling) {
      const pulse = (Math.sin(time * 8) * 0.5 + 0.5);
      ctx2d.save();
      ctx2d.globalAlpha = 0.5 * pulse;
      ctx2d.beginPath();
      ctx2d.arc(x, y, MAGNET_RADIUS + 6, 0, Math.PI * 2);
      ctx2d.strokeStyle = '#fbbf24';
      ctx2d.lineWidth = 2;
      ctx2d.stroke();
      ctx2d.restore();
    }
  }

  /* ── Public API ─────────────────────────────────────────── */
  function getArenaCenter() { return { ...arenaCenter }; }
  function getArenaRadius() { return arenaRadius; }
  function getMagnets() { return magnets; }
  function getStats() {
    return { totalChains, longestChain, totalTurns };
  }
  function destroy() {
    if (frameId) cancelAnimationFrame(frameId);
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
    init, placeMagnet, removeMagnet,
    getArenaCenter, getArenaRadius, getMagnets,
    getStats, destroy, playReplay, setLastPlaced,
    getReplayBuffer, getPracticeMode,
    get canvas() { return canvas; }
  };
})();
