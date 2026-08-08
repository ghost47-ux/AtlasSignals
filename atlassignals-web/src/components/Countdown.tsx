/**
 * Countdown.tsx — segmented countdown (d/h/m/s) boxes with a label.
 */
import { useEffect, useState } from 'react';
import { pad2, splitDuration } from '../lib/format';

export default function Countdown({
  target,
  labels = ['Days', 'Hrs', 'Min', 'Sec'],
}: {
  target: Date | number;
  labels?: [string, string, string, string];
}) {
  const targetMs = typeof target === 'number' ? target : target.getTime();
  const [left, setLeft] = useState(() => targetMs - Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setLeft(targetMs - Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [targetMs]);

  const { d, h, m, s } = splitDuration(left);
  const cells: [number, string][] = [
    [d, labels[0]],
    [h, labels[1]],
    [m, labels[2]],
    [s, labels[3]],
  ];

  return (
    <div className="countdown">
      {cells.map(([n, l]) => (
        <div className="cd-box" key={l}>
          <span className="n">{pad2(n)}</span>
          <span className="l">{l}</span>
        </div>
      ))}
    </div>
  );
}
