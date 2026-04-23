'use client';
import { useEffect, useRef } from 'react';
import { devAutoLogin } from './actions';

export function AutoLoginForm({ callbackUrl }: { callbackUrl: string }) {
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    ref.current?.requestSubmit();
  }, []);

  return (
    <form ref={ref} action={devAutoLogin} className="hidden">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
    </form>
  );
}
