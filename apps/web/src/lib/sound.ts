/**
 * Self-contained sound engine (Web Audio API) — no asset files. Reusable across
 * screens: call `Sound.play('card')` etc. Mute state persists in localStorage.
 *
 * Browsers block audio until a user gesture, so the AudioContext is created
 * lazily and resumed on the first interaction (see `primeAudio`).
 */
type SoundName = 'card' | 'trick' | 'turn' | 'deal' | 'win' | 'lose' | 'bid';

const STORAGE_KEY = 'tarneeb.muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = loadMuted();

function loadMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function ensureCtx(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface BlipOpts {
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  slideTo?: number;
}

function blip(freq: number, opts: BlipOpts = {}): void {
  const c = ensureCtx();
  if (!c || !master) return;
  const { dur = 0.12, type = 'sine', gain = 0.2, delay = 0, slideTo } = opts;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function whoosh(dur = 0.32, gain = 0.14): void {
  const c = ensureCtx();
  if (!c || !master) return;
  const t0 = c.currentTime;
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(500, t0);
  bp.frequency.exponentialRampToValueAtTime(2600, t0 + dur);
  bp.Q.value = 0.7;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur);
}

function render(name: SoundName): void {
  switch (name) {
    case 'card':
      blip(560, { type: 'square', dur: 0.05, gain: 0.1, slideTo: 380 });
      break;
    case 'bid':
      blip(520, { type: 'triangle', dur: 0.1, gain: 0.14 });
      break;
    case 'turn':
      blip(880, { type: 'sine', dur: 0.14, gain: 0.14 });
      break;
    case 'trick':
      blip(523, { type: 'sine', dur: 0.12, gain: 0.16 });
      blip(784, { type: 'sine', dur: 0.16, gain: 0.16, delay: 0.1 });
      break;
    case 'deal':
      whoosh();
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) =>
        blip(f, { type: 'triangle', dur: 0.22, gain: 0.16, delay: i * 0.12 }),
      );
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) =>
        blip(f, { type: 'sawtooth', dur: 0.24, gain: 0.12, delay: i * 0.14 }),
      );
      break;
  }
}

export const Sound = {
  play(name: SoundName): void {
    if (muted) return;
    render(name);
  },
  isMuted(): boolean {
    return muted;
  },
  setMuted(value: boolean): void {
    muted = value;
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
      /* ignore storage failures */
    }
  },
  toggle(): boolean {
    this.setMuted(!muted);
    return muted;
  },
};

/** Attach one-time listeners so the AudioContext resumes on first interaction. */
export function primeAudio(): void {
  const resume = () => {
    ensureCtx();
    window.removeEventListener('pointerdown', resume);
    window.removeEventListener('keydown', resume);
  };
  window.addEventListener('pointerdown', resume, { once: true });
  window.addEventListener('keydown', resume, { once: true });
}
