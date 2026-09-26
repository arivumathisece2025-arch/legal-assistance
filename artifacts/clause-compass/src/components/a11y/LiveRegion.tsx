'use client';

import { useEffect, useState } from 'react';

export function LiveRegion() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    const handleAnnouncement = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setMessage(detail ?? '');
    };

    window.addEventListener('a11y-announce', handleAnnouncement);
    return () => window.removeEventListener('a11y-announce', handleAnnouncement);
  }, []);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" role="status">
      {message}
    </div>
  );
}

export function announce(message: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('a11y-announce', { detail: message }));
}
