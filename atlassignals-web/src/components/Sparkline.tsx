/**
 * Sparkline.tsx — deterministic decorative price curve from a seed string.
 * Smooth cubic path, gradient fill, green glow. Pure SVG — no chart lib.
 */
import { useMemo } from 'react';

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export default function Sparkline({
  seed,
  width = 120,
  height = 44,
  up = true,
}: {
  seed: string;
  width?: number;
  height?: number;
  up?: boolean;
}) {
  const path = useMemo(() => {
    const n = 22;
    const pts: [number, number][] = [];
    const rnd = mulberry32(hashSeed(seed));
    let y = height * (0.35 + rnd() * 0.3);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * width;
      y += (rnd() - (up ? 0.38 : 0.62)) * height * 0.22;
      y = Math.max(6, Math.min(height - 6, y));
      pts.push([x, y]);
    }
    // Catmull-Rom → cubic Bézier.
    let d = `M ${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }, [seed, width, height, up]);

  const color = up ? '#00ffa3' : '#ff5c7a';
  const area = `${path} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`sg-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${seed})`} />
      <path
        d={path}
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        className="chart-glow"
      />
    </svg>
  );
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
