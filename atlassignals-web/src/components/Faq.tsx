/**
 * Faq.tsx — accessible accordion. Keyboard: Enter/Space toggles.
 */
import { useState } from 'react';
import { FAQ_ITEMS } from '../lib/site';

export default function Faq() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div style={{ maxWidth: 760, marginInline: 'auto' }}>
      {FAQ_ITEMS.map((item, i) => {
        const open = openIdx === i;
        return (
          <div className={`faq-item ${open ? 'open' : ''}`} key={item.q}>
            <button
              className="faq-q"
              aria-expanded={open}
              onClick={() => setOpenIdx(open ? null : i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenIdx(open ? null : i);
                }
              }}
            >
              {item.q}
              <span className="chev">+</span>
            </button>
            <div className="faq-a">
              <p>{item.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
