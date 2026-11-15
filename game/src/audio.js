// Synthesised sound only: every effect is built from oscillators and filtered
// noise through WebAudio, so the game ships no audio files and makes no requests.
// The context is created lazily on the first user gesture (browsers require it);
// in screenshot mode it stays uncreated and every call is a safe no-op.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noiseBuffer(duration) {
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // A burst of noise through a low-pass filter: the core of every gunshot.
  function burst({ duration = 0.12, cutoff = 2400, gain = 0.5, when = 0 }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(duration + 0.02);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.25), t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(amp).connect(master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  // A short pitched tone: beeps, ticks, chimes and jingles.
  function tone({ freq = 440, to = null, duration = 0.08, gain = 0.25, type = 'sine', when = 0 }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  const api = {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    get muted() { return muted; },
    shot(kind) {
      if (kind === 'rifle') { burst({ duration: 0.13, cutoff: 2600, gain: 0.55 }); tone({ freq: 160, to: 60, duration: 0.09, gain: 0.3, type: 'square' }); }
      else if (kind === 'smg') { burst({ duration: 0.08, cutoff: 3200, gain: 0.4 }); tone({ freq: 190, to: 80, duration: 0.06, gain: 0.22, type: 'square' }); }
      else if (kind === 'marksman') { burst({ duration: 0.22, cutoff: 1800, gain: 0.7 }); tone({ freq: 110, to: 45, duration: 0.18, gain: 0.4, type: 'square' }); }
      else if (kind === 'pistol') { burst({ duration: 0.09, cutoff: 3000, gain: 0.42 }); }
      else if (kind === 'bot') { burst({ duration: 0.1, cutoff: 1400, gain: 0.16 }); }
    },
    dryFire() { tone({ freq: 900, duration: 0.03, gain: 0.12, type: 'square' }); },
    reload() {
      tone({ freq: 1400, duration: 0.03, gain: 0.14, type: 'square' });
      tone({ freq: 700, duration: 0.04, gain: 0.16, type: 'square', when: 0.22 });
      tone({ freq: 1100, duration: 0.05, gain: 0.18, type: 'square', when: 0.55 });
    },
    hit(head) {
      tone({ freq: head ? 1560 : 1180, duration: 0.05, gain: 0.22, type: 'sine' });
      if (head) tone({ freq: 2090, duration: 0.09, gain: 0.18, type: 'sine', when: 0.05 });
    },
    kill() {
      tone({ freq: 660, duration: 0.09, gain: 0.22, type: 'triangle' });
      tone({ freq: 990, duration: 0.14, gain: 0.22, type: 'triangle', when: 0.08 });
    },
    hurt() { tone({ freq: 220, to: 110, duration: 0.16, gain: 0.3, type: 'sawtooth' }); },
    step() { burst({ duration: 0.04, cutoff: 500, gain: 0.07 }); },
    plantBeep() { tone({ freq: 1250, duration: 0.06, gain: 0.2, type: 'square' }); },
    defuseBeep() { tone({ freq: 880, duration: 0.06, gain: 0.2, type: 'square' }); },
    planted() {
      tone({ freq: 1250, duration: 0.1, gain: 0.25, type: 'square' });
      tone({ freq: 1250, duration: 0.1, gain: 0.25, type: 'square', when: 0.16 });
      tone({ freq: 1560, duration: 0.22, gain: 0.25, type: 'square', when: 0.32 });
    },
    explosion() {
      burst({ duration: 0.9, cutoff: 900, gain: 0.9 });
      tone({ freq: 70, to: 28, duration: 0.8, gain: 0.5, type: 'sine' });
    },
    grenadeThrow() { burst({ duration: 0.12, cutoff: 900, gain: 0.15 }); },
    roundWin() {
      [523, 659, 784].forEach((f, i) => tone({ freq: f, duration: 0.16, gain: 0.22, type: 'triangle', when: i * 0.13 }));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => tone({ freq: f, duration: 0.2, gain: 0.2, type: 'triangle', when: i * 0.15 }));
    },
    buy() { tone({ freq: 980, duration: 0.06, gain: 0.18, type: 'sine' }); tone({ freq: 1320, duration: 0.09, gain: 0.16, type: 'sine', when: 0.06 }); },
    deny() { tone({ freq: 180, duration: 0.12, gain: 0.2, type: 'square' }); },
    chargeTick() { tone({ freq: 1560, duration: 0.04, gain: 0.14, type: 'square' }); },
    thunder() {
      burst({ duration: 1.6, cutoff: 320, gain: 0.5 });
      tone({ freq: 55, to: 30, duration: 1.4, gain: 0.4, type: 'sine' });
      burst({ duration: 0.9, cutoff: 220, gain: 0.3, when: 0.35 });
    },
    rain() {
      // A soft looping wash of filtered noise, started once on first unlock.
      if (!ensure() || muted || this._rainOn) return;
      this._rainOn = true;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(2);
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1400;
      filter.Q.value = 0.4;
      const amp = ctx.createGain();
      amp.gain.value = 0.045;
      src.connect(filter).connect(amp).connect(master);
      src.start();
    },
  };
  return api;
}
