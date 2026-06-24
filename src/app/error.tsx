'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => supabase.from('client_error_events').insert({ user_id: data.user?.id || null, message: error.message, stack: error.stack, context: { digest: error.digest, path: window.location.pathname, userAgent: navigator.userAgent } }));
  }, [error]);

  return <main className="grid min-h-screen place-items-center bg-[#0d0e12] p-6 text-white"><div className="max-w-md text-center"><AlertTriangle className="mx-auto mb-4 h-12 w-12 text-red-400" /><h1 className="text-2xl font-bold">Something went wrong</h1><p className="mt-2 text-sm text-gray-400">The error was recorded for the administrators.</p><button onClick={reset} className="mt-6 rounded-xl bg-brand-gradient px-5 py-3 font-semibold">Try again</button></div></main>;
}
