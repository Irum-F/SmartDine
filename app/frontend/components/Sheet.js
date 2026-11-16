'use client';

import { useEffect, useRef } from 'react';

// Bottom sheet. Sheets can stack (the order sheet over the table sheet); only the top one reacts.
export default function Sheet({ title, onClose, children, footer }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || !onClose) return;
      const all = document.querySelectorAll('.backdrop');
      if (all[all.length - 1] === ref.current) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      if (!document.querySelector('.backdrop')) document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="backdrop" ref={ref} onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon" aria-label="Close" onClick={onClose}>
              ×
            </button>
          )}
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}