'use client';

import { useEffect, useState } from 'react';

export function FontToggle() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const enabled = localStorage.getItem('dyslexia-font') === 'true';
    setActive(enabled);
    document.documentElement.classList.toggle('font-dyslexia', enabled);
  }, []);

  const toggle = () => {
    const next = !active;
    setActive(next);
    document.documentElement.classList.toggle('font-dyslexia', next);
    localStorage.setItem('dyslexia-font', String(next));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={active}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-50"
    >
      {active ? 'Standard Font' : 'Dyslexia-Friendly Font'}
    </button>
  );
}
