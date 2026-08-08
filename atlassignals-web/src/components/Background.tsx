/**
 * Background.tsx — ambient animated backdrop.
 *
 * A slow-drifting dot grid + floating particles in electric green and blue on
 * canvas (DPR-aware, paused when the tab is hidden), plus soft CSS glow orbs.
 * Purely decorative; GPU-light.
 */
import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  alpha: number;
}

const COLORS = ['0,255,163', '59,130,246', '34,211,238'];

export default function Background() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let particles: Particle[] = [];

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(90, Math.floor((w * h) / 24000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        r: Math.random() * 1.8 + 0.6,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        alpha: Math.random() * 0.5 + 0.15,
      }));
    };

    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;

      ctx.clearRect(0, 0, w, h);

      // Dot grid (60px pitch), slow diagonal drift.
      const drift = (performance.now() / 24000) * 60;
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      const pitch = 60;
      const ox = ((drift % pitch) + pitch) % pitch;
      const oy = ((drift % pitch) + pitch) % pitch;
      for (let x = -pitch + ox; x < w + pitch; x += pitch) {
        for (let y = -pitch + oy; y < h + pitch; y += pitch) {
          ctx.fillRect(x, y, 1.4, 1.4);
        }
      }

      // Particles.
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
        ctx.fill();
      }

      if (running) raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      running = !document.hidden;
      if (running) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: -1, overflow: 'hidden' }}>
      <canvas ref={canvasRef} />
      <div
        style={{
          position: 'absolute',
          top: '-18%',
          left: '-12%',
          width: '52vw',
          height: '52vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,255,163,0.07), transparent 62%)',
          filter: 'blur(30px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-22%',
          right: '-14%',
          width: '58vw',
          height: '58vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59,130,246,0.09), transparent 62%)',
          filter: 'blur(34px)',
        }}
      />
    </div>
  );
}
