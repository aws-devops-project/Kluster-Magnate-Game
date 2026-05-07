/**
 * audio.js — Web Audio API synthesized sounds
 * No external audio files needed.
 */

const AudioEngine = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** Magnetic hum (continuous, spatial) */
  let humNodes = {};

  function startHum(id, frequency = 80, volume = 0.04) {
    if (humNodes[id]) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.value = 0;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    osc.start();
    gain.gain.linearRampToValueAtTime(volume, c.currentTime + 0.1);
    humNodes[id] = { osc, gain, filter };
  }

  function setHumVolume(id, vol) {
    if (!humNodes[id]) return;
    const c = getCtx();
    humNodes[id].gain.gain.linearRampToValueAtTime(vol, c.currentTime + 0.05);
  }

  function stopHum(id) {
    if (!humNodes[id]) return;
    const c = getCtx();
    const { gain, osc } = humNodes[id];
    gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.15);
    setTimeout(() => { try { osc.stop(); } catch(e){} }, 200);
    delete humNodes[id];
  }

  function stopAllHums() {
    Object.keys(humNodes).forEach(stopHum);
  }

  /** Tiny metal tick while magnets hesitate in tension */
  function playTick(intensity = 0.2) {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();

    osc.type = 'square';
    osc.frequency.setValueAtTime(1600 + intensity * 900, c.currentTime);
    filter.type = 'bandpass';
    filter.frequency.value = 2200;
    filter.Q.value = 1.1;
    gain.gain.setValueAtTime(0.08 * intensity, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.03);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.04);
  }

  /** Single snap click */
  function playSnap(intensity = 1.0) {
    const c = getCtx();
    const duration = 0.06 + intensity * 0.04;

    // Metallic transient — filtered noise
    const bufferSize = c.sampleRate * duration;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.15));
    }

    const source = c.createBufferSource();
    source.buffer = buffer;

    const bandpass = c.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1800 + intensity * 600;
    bandpass.Q.value = 1.5;

    const gain = c.createGain();
    gain.gain.value = 0.6 * intensity;

    source.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(c.destination);
    source.start();

    // Sub thump
    const thump = c.createOscillator();
    const thumpGain = c.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(120 * intensity, c.currentTime);
    thump.frequency.exponentialRampToValueAtTime(30, c.currentTime + 0.08);
    thumpGain.gain.setValueAtTime(0.4 * intensity, c.currentTime);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.1);
    thump.connect(thumpGain);
    thumpGain.connect(c.destination);
    thump.start();
    thump.stop(c.currentTime + 0.12);
  }

  /** Short table impact after lock */
  function playImpact(intensity = 0.5) {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(52, c.currentTime + 0.12);
    gain.gain.setValueAtTime(0.18 * intensity, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.16);
  }

  /** Chain reaction — multiple snaps with delay */
  function playChainReaction(count = 3) {
    const delay = 0.08;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        playSnap(0.5 + (i / count) * 0.8);
      }, i * delay * 1000);
    }
  }

  /** Table hit / boundary bump */
  function playBoundaryHit(intensity = 0.5) {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, c.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2 * intensity, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.25);
  }

  /** Turn change chime */
  function playTurnChime() {
    const c = getCtx();
    [440, 554, 659].forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, c.currentTime + i * 0.08);
      gain.gain.linearRampToValueAtTime(0.12, c.currentTime + i * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + i * 0.08 + 0.3);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(c.currentTime + i * 0.08);
      osc.stop(c.currentTime + i * 0.08 + 0.4);
    });
  }

  /** Win fanfare */
  function playWin() {
    const c = getCtx();
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t = c.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  }

  return {
    startHum,
    setHumVolume,
    stopHum,
    stopAllHums,
    playTick,
    playSnap,
    playImpact,
    playChainReaction,
    playBoundaryHit,
    playTurnChime,
    playWin
  };
})();
