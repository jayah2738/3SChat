'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, KeyRound, Loader2, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function LoginPage() {
  const { signInWithGoogle, sendOTP, verifyOTP, sessionKickout, resetKickout, loading, user } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'identity' | 'otp'>('identity');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (user) window.location.replace('/chat');
  }, [user]);

  async function handleSendOTP(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    resetKickout();

    if (!/^\+?[\d\s().-]{8,}$/.test(phoneNumber)) {
      setError('Enter a valid phone number including its country code.');
      return;
    }

    setIsPending(true);
    const result = await sendOTP(phoneNumber, email, displayName);
    setIsPending(false);
    if (result.success) setStep('otp');
    else setError(result.error || 'The email code could not be sent.');
  }

  async function handleGoogleLogin() {
    setError(null);
    resetKickout();
    setIsPending(true);
    const result = await signInWithGoogle();
    if (!result.success) {
      setIsPending(false);
      setError(result.error || 'Google sign-in could not be started.');
    }
  }

  async function handleVerifyOTP(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^\d{8}$/.test(otpCode)) {
      setError('Enter the eight-digit code from your email.');
      return;
    }

    setIsPending(true);
    const result = await verifyOTP(phoneNumber, email, otpCode);
    setIsPending(false);
    if (!result.success) setError(result.error || 'The code is invalid or expired.');
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d0e12]">
        <Loader2 className="h-10 w-10 animate-spin text-blue-500" aria-label="Loading" />
      </div>
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-animated-gradient p-4">
      <div className="absolute left-1/4 top-1/4 h-[300px] w-[300px] animate-pulse rounded-full bg-blue-600 opacity-25 blur-[120px]" />
      <div className="absolute bottom-1/4 right-1/4 h-[350px] w-[350px] animate-pulse rounded-full bg-red-600 opacity-20 blur-[130px]" />

      <div className="z-10 w-full max-w-md">
        <header className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-brand-gradient shadow-lg shadow-blue-500/20">
            <ShieldCheck className="h-9 w-9 text-white" />
          </div>
          <h1 className="bg-gradient-to-r from-blue-400 to-red-400 bg-clip-text text-4xl font-extrabold tracking-wider text-transparent">3SChat</h1>
          <p className="mt-1 text-sm text-gray-400">Private messaging, backed by a real database</p>
        </header>

        <AnimatePresence>
          {sessionKickout && (
            <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-5 flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-semibold text-red-300">Session closed</p>
                <p className="mt-1 text-xs text-red-300/80">This account was activated on another device. Only the newest verified session can access messages.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <section className="glass-container relative rounded-3xl p-8 shadow-2xl">
          <div className="absolute inset-x-0 top-0 h-1 rounded-t-3xl bg-brand-gradient" />
          <AnimatePresence mode="wait">
            {step === 'identity' ? (
              <motion.div key="identity" initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 15 }}>
                <h2 className="mb-2 text-2xl font-bold text-white">Sign in securely</h2>
                <p className="mb-5 text-sm leading-relaxed text-gray-400">Google is the recommended free sign-in method. You can still use your phone number with an email verification code.</p>
                <button type="button" onClick={() => void handleGoogleLogin()} disabled={isPending} className="relative flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white py-3 font-semibold text-gray-900 transition hover:bg-gray-100 disabled:opacity-60">
                  <GoogleIcon />
                  {isPending ? 'Connecting to Google…' : 'Continue with Google'}
                  <span className="absolute right-3 hidden rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 sm:inline">Recommended</span>
                </button>
                <ErrorMessage error={error} />
                <div className="my-5 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-gray-500"><span className="h-px flex-1 bg-white/10" /><span>or use email OTP</span><span className="h-px flex-1 bg-white/10" /></div>
                <form onSubmit={handleSendOTP} className="space-y-4">
                  <Field icon={Phone} label="Phone number">
                    <input type="tel" autoComplete="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+254 700 000 000" required disabled={isPending} className="glass-input w-full rounded-xl py-3 pl-10 pr-3" />
                  </Field>
                  <Field icon={Mail} label="Verification email">
                    <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required disabled={isPending} className="glass-input w-full rounded-xl py-3 pl-10 pr-3" />
                  </Field>
                  <Field icon={UserRound} label="Display name (new accounts)">
                    <input type="text" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How people see you" maxLength={60} disabled={isPending} className="glass-input w-full rounded-xl py-3 pl-10 pr-3" />
                  </Field>
                  <button disabled={isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient py-3 font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
                    {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Mail className="h-4 w-4" /> Email my code</>}
                  </button>
                </form>
              </motion.div>
            ) : (
              <motion.div key="otp" initial={{ opacity: 0, x: 15 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -15 }}>
                <h2 className="mb-2 text-2xl font-bold text-white">Check your email</h2>
                <p className="mb-6 text-sm text-gray-400">Enter the eight-digit code sent to <span className="font-medium text-white">{email}</span>. It expires shortly.</p>
                <form onSubmit={handleVerifyOTP} className="space-y-4">
                  <Field icon={KeyRound} label="Verification code">
                    <input inputMode="numeric" autoComplete="one-time-code" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ''))} maxLength={8} pattern="\d{8}" placeholder="00000000" required disabled={isPending} className="glass-input w-full rounded-xl py-3 pl-10 pr-3 text-center font-mono text-xl tracking-[0.3em]" />
                  </Field>
                  <ErrorMessage error={error} />
                  <div className="flex gap-3">
                    <button type="button" onClick={() => { setStep('identity'); setOtpCode(''); setError(null); }} disabled={isPending} className="w-1/3 rounded-xl border border-white/10 py-3 text-sm font-semibold text-gray-300 hover:bg-white/5">Back</button>
                    <button disabled={isPending} className="flex w-2/3 items-center justify-center rounded-xl bg-brand-gradient py-3 font-semibold text-white disabled:opacity-60">
                      {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Verify & enter'}
                    </button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-500"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Google or email OTP · database session lock · row-level security</p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.55h3.24c1.9-1.75 2.98-4.33 2.98-7.42Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.35l-3.24-2.55c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.63A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.93A6.01 6.01 0 0 1 6.08 12c0-.67.12-1.32.31-1.93V7.44H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.56l3.35-2.63Z" />
      <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.44l3.35 2.63C7.18 7.7 9.39 5.94 12 5.94Z" />
    </svg>
  );
}

function Field({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      <span className="relative block">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
        {children}
      </span>
    </label>
  );
}

function ErrorMessage({ error }: { error: string | null }) {
  return error ? <div role="alert" className="rounded-lg border border-red-500/20 bg-red-950/20 p-3 text-xs font-medium text-red-400">{error}</div> : null;
}
