'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Phone, Key, AlertTriangle, HelpCircle, Loader2 } from 'lucide-react';
import { IS_MOCK_MODE } from '../../lib/supabaseClient';

export default function LoginPage() {
  const { sendOTP, verifyOTP, sessionKickout, resetKickout, loading } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [showDemoHelp, setShowDemoHelp] = useState(false);

  // Clear kickout banner when interacting with login
  useEffect(() => {
    return () => {
      resetKickout();
    };
  }, [resetKickout]);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Basic Validation: check length
    const digitsOnly = phoneNumber.replace(/\D/g, '');
    if (digitsOnly.length < 8) {
      setError('Please enter a valid phone number (at least 8 digits).');
      return;
    }

    setIsPending(true);
    const res = await sendOTP(phoneNumber);
    setIsPending(false);

    if (res.success) {
      setStep('otp');
      if (IS_MOCK_MODE) {
        // Automatically show demo help for instant code copy
        setShowDemoHelp(true);
        alert(`[Demo Mode] SMS simulated! Since the app is running in Sandbox mode, please enter the security code '123456' to proceed.`);
      }
    } else {
      setError(res.error || 'Failed to send OTP code.');
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (otpCode.length !== 6) {
      setError('Verification code must be exactly 6 digits.');
      return;
    }

    setIsPending(true);
    const res = await verifyOTP(phoneNumber, otpCode);
    setIsPending(false);

    if (!res.success) {
      setError(res.error || 'Invalid code.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0e12] flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
          <p className="text-gray-400 font-medium">Securing connection...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-animated-gradient flex items-center justify-center p-4 relative overflow-hidden">
      
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/4 w-[300px] h-[300px] bg-blue-600 rounded-full blur-[120px] opacity-25 animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-[350px] h-[350px] bg-red-600 rounded-full blur-[130px] opacity-20 animate-pulse" style={{ animationDelay: '2s' }} />

      <div className="w-full max-w-md z-10">
        
        {/* Header Logo */}
        <div className="flex flex-col items-center mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, type: 'spring' }}
            className="w-16 h-16 bg-brand-gradient rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 mb-3 border border-white/10"
          >
            <ShieldCheck className="w-9 h-9 text-white" />
          </motion.div>
          <motion.h1 
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-4xl font-extrabold tracking-wider bg-gradient-to-r from-blue-400 to-red-400 bg-clip-text text-transparent"
          >
            3SChat
          </motion.h1>
          <p className="text-gray-400 text-sm mt-1">Ironclad Private Messaging</p>
        </div>

        {/* Kickout Alert Banner */}
        <AnimatePresence>
          {sessionKickout && (
            <motion.div
              initial={{ height: 0, opacity: 0, y: -20 }}
              animate={{ height: 'auto', opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -20 }}
              className="mb-6 overflow-hidden"
            >
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start space-x-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-red-400">Security Alert</h4>
                  <p className="text-xs text-red-300/80 mt-1">
                    Your account was logged in from another device. For security, this session was closed automatically.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Login Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass-container rounded-3xl p-8 shadow-2xl relative"
        >
          {/* Top colored accent line */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-brand-gradient rounded-t-3xl" />

          <AnimatePresence mode="wait">
            {step === 'phone' ? (
              <motion.div
                key="phone-step"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
              >
                <h2 className="text-2xl font-bold text-white mb-2">Get Started</h2>
                <p className="text-gray-400 text-sm mb-6">
                  Verify your identity using your phone number. Secure single-session auth will be activated.
                </p>

                <form onSubmit={handleSendOTP} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Phone Number
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Phone className="h-5 h-5 text-gray-500" />
                      </div>
                      <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+1 (555) 000-0000"
                        disabled={isPending}
                        required
                        className="glass-input block w-full pl-10 pr-3 py-3 rounded-xl text-base focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <span className="text-[10px] text-gray-500 mt-1.5 block">
                      Include country code (e.g. +1 for USA, +44 for UK, etc.)
                    </span>
                  </div>

                  {error && (
                    <div className="text-red-400 text-xs font-medium bg-red-950/20 border border-red-500/20 p-3 rounded-lg">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isPending}
                    className="w-full py-3 rounded-xl bg-brand-gradient hover:opacity-95 text-white font-semibold transition-all duration-300 shadow-lg shadow-blue-500/10 flex items-center justify-center space-x-2 cursor-pointer"
                  >
                    {isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <span>Verify Securely</span>
                        <ShieldCheck className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              </motion.div>
            ) : (
              <motion.div
                key="otp-step"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <h2 className="text-2xl font-bold text-white mb-2">Enter Verification Code</h2>
                <p className="text-gray-400 text-sm mb-6">
                  We have sent a security code to <span className="text-white font-medium">{phoneNumber}</span>.
                </p>

                <form onSubmit={handleVerifyOTP} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      6-Digit Security Code
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Key className="h-5 w-5 text-gray-500" />
                      </div>
                      <input
                        type="text"
                        maxLength={6}
                        pattern="\d{6}"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="000000"
                        disabled={isPending}
                        required
                        className="glass-input block w-full pl-10 pr-3 py-3 rounded-xl text-center text-xl tracking-widest font-mono"
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="text-red-400 text-xs font-medium bg-red-950/20 border border-red-500/20 p-3 rounded-lg">
                      {error}
                    </div>
                  )}

                  <div className="flex space-x-3">
                    <button
                      type="button"
                      onClick={() => setStep('phone')}
                      disabled={isPending}
                      className="w-1/3 py-3 rounded-xl border border-white/10 text-gray-300 font-semibold hover:bg-white/5 transition-all text-sm cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={isPending}
                      className="w-2/3 py-3 rounded-xl bg-brand-gradient hover:opacity-95 text-white font-semibold transition-all duration-300 shadow-lg shadow-blue-500/10 flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      {isPending ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <span>Verify & Enter</span>
                      )}
                    </button>
                  </div>
                </form>

                {/* Simulated Mode Banner */}
                {IS_MOCK_MODE && showDemoHelp && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 p-4 rounded-xl bg-blue-950/20 border border-blue-500/20 flex items-start space-x-2 text-xs text-blue-300"
                  >
                    <HelpCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-blue-400">Sandbox Demo Mode Active</p>
                      <p className="mt-0.5 leading-relaxed text-blue-300/80">
                        Since Supabase API key is currently mocked, verify with code: <strong className="text-white font-bold text-sm bg-blue-500/20 px-1.5 py-0.5 rounded ml-1 font-mono">123456</strong>
                      </p>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Security badge footer */}
        <div className="flex items-center justify-center space-x-2 mt-8 text-gray-500 text-xs">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Secured by Supabase and session pinning</span>
        </div>
      </div>
    </div>
  );
}
