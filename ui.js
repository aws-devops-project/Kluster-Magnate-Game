/**
 * ui.js — HUD, screen transitions, DOM management
 */

const UI = (() => {
  /* ── Screen management ──────────────────────────────────── */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active');
    });
    const target = document.getElementById(id);
    if (target) {
      target.classList.add('active');
      // Force reflow for animation
      void target.offsetWidth;
    }
  }

  /* ── HUD ────────────────────────────────────────────────── */
  function setPlayerName(player, name) {
    const el = document.getElementById(`hud-p${player}-name`);
    if (el) el.textContent = name;
  }

  function setMagnetCount(player, total, remaining) {
    const countEl = document.getElementById(`hud-p${player}-count`);
    if (countEl) countEl.textContent = remaining;

    const dotContainer = document.getElementById(`p${player}-magnet-dots`);
    if (dotContainer) {
      dotContainer.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const dot = document.createElement('span');
        dot.className = `m-dot${player === 2 ? ' p2' : ''}${i >= remaining ? ' used' : ''}`;
        dotContainer.appendChild(dot);
      }
    }
  }

  function setTurn(player, name) {
    const indicator = document.getElementById('turn-indicator');
    const text = document.getElementById('turn-text');
    if (!indicator || !text) return;
    indicator.className = `turn-indicator p${player}-turn`;
    text.textContent = `${name}'s Turn`;
    // Animate
    indicator.style.animation = 'none';
    void indicator.offsetWidth;
    indicator.style.animation = '';
  }

  /* ── Snap overlay ────────────────────────────────────────── */
  let snapTimeout = null;

  function showSnapOverlay(info, callback) {
    const overlay = document.getElementById('overlay-snap');
    const snapText = document.getElementById('snap-text');
    const snapInfo = document.getElementById('snap-info');

    if (snapTimeout) clearTimeout(snapTimeout);

    overlay.classList.remove('hidden');

    if (info.chainCount >= 4) {
      snapText.textContent = '🔥 CHAIN!';
    } else if (info.chainCount >= 3) {
      snapText.textContent = 'SNAP!';
    } else {
      snapText.textContent = 'CLICK!';
    }

    snapInfo.textContent = `${info.chainCount} magnets connected! +${info.chainCount} penalty to P${info.culpritPlayer}`;

    // Re-trigger animations
    const rings = overlay.querySelectorAll('.snap-ring');
    rings.forEach(r => { r.style.animation = 'none'; void r.offsetWidth; r.style.animation = ''; });
    const st = overlay.querySelector('.snap-text');
    if (st) { st.style.animation = 'none'; void st.offsetWidth; st.style.animation = 'snap-text 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards'; }

    snapTimeout = setTimeout(() => {
      overlay.classList.add('hidden');
      if (callback) callback();
    }, 2200);
  }

  /* ── Replay bar ─────────────────────────────────────────── */
  function showReplayBar(show) {
    const bar = document.getElementById('replay-bar');
    if (bar) bar.classList.toggle('hidden', !show);
  }

  /* ── Placement hint ─────────────────────────────────────── */
  function setHint(text) {
    const el = document.getElementById('placement-hint');
    if (el) {
      el.textContent = text;
      el.style.opacity = text ? '1' : '0';
    }
  }

  /* ── Result screen ─────────────────────────────────────── */
  function showResult(winner, subtitle, stats) {
    document.getElementById('result-title').textContent = winner;
    document.getElementById('result-subtitle').textContent = subtitle;
    document.getElementById('stat-turns').textContent = stats.totalTurns || 0;
    document.getElementById('stat-chains').textContent = stats.totalChains || 0;
    document.getElementById('stat-longest').textContent = stats.longestChain || 0;
    showScreen('screen-result');
    AudioEngine.playWin();
  }

  /* ── Waiting room ───────────────────────────────────────── */
  function setRoomCode(code) {
    const el = document.getElementById('room-code-display');
    if (el) el.textContent = code;
  }

  function setWaitingPlayer(slot, name, ready) {
    const nameEl = document.getElementById(`slot-p${slot}-name`);
    const avatar = document.querySelector(`#slot-p${slot} .player-avatar`);
    if (nameEl) nameEl.textContent = name;
    if (avatar) avatar.textContent = name.slice(0, 2).toUpperCase();

    const dots = document.querySelector(`#slot-p${slot} .waiting-dots`);
    const badge = document.querySelector(`#slot-p${slot} .ready-badge`);
    if (dots) dots.style.display = ready ? 'none' : '';
    if (badge) badge.style.display = ready ? '' : 'none';
  }

  /* ── Connection status ─────────────────────────────────── */
  function setConnStatus(state, text) {
    const el = document.getElementById('connection-status');
    const textEl = document.getElementById('conn-text');
    if (!el) return;
    el.className = `conn-status ${state}`;
    if (textEl) textEl.textContent = text;
  }

  /* ── Button ripple effect ───────────────────────────────── */
  document.addEventListener('click', e => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.cssText = `
      width: ${size}px; height: ${size}px;
      left: ${e.clientX - rect.left - size/2}px;
      top: ${e.clientY - rect.top - size/2}px;
    `;
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });

  /* ── Pause overlay ──────────────────────────────────────── */
  function showPause(show) {
    const el = document.getElementById('overlay-pause');
    if (el) el.classList.toggle('hidden', !show);
  }

  return {
    showScreen, setPlayerName, setMagnetCount, setTurn,
    showSnapOverlay, showReplayBar, setHint, showResult,
    setRoomCode, setWaitingPlayer, setConnStatus, showPause
  };
})();
