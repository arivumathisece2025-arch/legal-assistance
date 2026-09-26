'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { announce } from './LiveRegion';

export function AccessibleForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error && errorSummaryRef.current) {
      errorSummaryRef.current.focus();
    }
  }, [error]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      const message = 'Please enter a valid email address.';
      setError(message);
      announce(message);
      return;
    }

    setError(null);
    announce('Form submitted successfully.');
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 max-w-md">
      {error && (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-red-500 bg-red-50 p-3 text-sm font-medium text-red-700 focus:outline-none"
        >
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="a11y-contact-email" className="block text-sm font-medium text-slate-800">
          Contact Email <span aria-hidden="true">*</span>
        </label>
        <input
          id="a11y-contact-email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? 'a11y-email-error' : undefined}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
          required
        />
        {error && (
          <p id="a11y-email-error" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500"
      >
        Submit Analysis Request
      </button>
    </form>
  );
}
