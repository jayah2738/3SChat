'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, KeyRound, Loader2, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function LoginPage() {
  const { sendOTP, verifyOTP, sessionKickout, resetKickout, loading, user } = useAuth();
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
                <p className="mb-6 text-sm leading-relaxed text-gray-400">Your phone number identifies your account. The verification code is delivered to your email—no Twilio or SMS.</p>
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
                  <ErrorMessage error={error} />
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

        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-500"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Email OTP · database session lock · row-level security</p>
      </div>
    </main>
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
