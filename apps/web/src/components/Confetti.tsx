import { useEffect, useRef } from 'react';

const COLORS = ['#f2b13c', '#2ed573', '#c02531', '#6a3aa0', '#3aa0e0', '#f4eefb'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vrot: number;
  color: string;
}

/**
 * Self-contained canvas confetti burst. Renders for `durationMs` then fades.
 * Reusable on any celebratory screen. Purely decorative (pointer-events: none).
 */
export function Confetti({ count = 140, durationMs = 2800 }: { count?: number; durationMs?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.5,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 3.5,
      size: 5 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    }));

    let raf = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const elapsed = now - start;
      const fade = Math.max(0, 1 - Math.max(0, elapsed - durationMs * 0.6) / (durationMs * 0.4));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = fade;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.03; // gravity
        p.rot += p.vrot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (elapsed < durationMs) raf = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(raf);
  }, [count, durationMs]);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}
