'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import {
  getSessionId,
  normalizePhone,
  type Profile,
  supabase,
  type UserSession,
} from '../lib/supabaseClient';

interface AuthResult {
  success: boolean;
  error?: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  sessionKickout: boolean;
  sendOTP: (phoneNumber: string, email: string, displayName: string) => Promise<AuthResult>;
  verifyOTP: (phoneNumber: string, email: string, code: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  updateProfile: (displayName: string, status: string, avatarUrl?: string) => Promise<AuthResult>;
  changeEmail: (email: string) => Promise<AuthResult>;
  changePhone: (phone: string) => Promise<AuthResult>;
  resetKickout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionKickout, setSessionKickout] = useState(false);
  const router = useRouter();

  const clearLocalAuth = useCallback(async (kicked = false) => {
    if (kicked) setSessionKickout(true);
    setUser(null);
    setProfile(null);
    await supabase.auth.signOut({ scope: 'local' });
    router.replace('/login');
  }, [router]);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, phone_number, display_name, avatar_url, status, last_seen, role, account_status, suspension_reason, suspended_at')
      .eq('id', userId)
      .single();

    if (error) throw error;
    setProfile(data as Profile);
  }, []);

  useEffect(() => {
    let alive = true;

    async function restoreSession() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!session) return;

        const { data: isActive, error: activeError } = await supabase.rpc('is_active_session');
        if (activeError || !isActive) {
          await clearLocalAuth(true);
          return;
        }

        if (!alive) return;
        setUser(session.user);
        await loadProfile(session.user.id);
      } catch (error) {
        console.error('Unable to restore the authenticated session:', error);
        await clearLocalAuth(false);
      } finally {
        if (alive) setLoading(false);
      }
    }

    void restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' && alive) {
        setUser(null);
        setProfile(null);
      } else if (event === 'TOKEN_REFRESHED' && session?.user && alive) {
        setUser(session.user);
      }
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [clearLocalAuth, loadProfile]);

  useEffect(() => {
    if (!user) return;

    let currentSessionId: string | null = null;
    void supabase.auth.getSession().then(({ data }) => {
      currentSessionId = getSessionId(data.session?.access_token);
    });

    const channel = supabase
      .channel(`account-session-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_sessions',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const changed = payload.new as UserSession | undefined;
          if (!changed || changed.active_session_id !== currentSessionId) {
            void clearLocalAuth(true);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clearLocalAuth, user]);

  const sendOTP = async (phoneNumber: string, email: string, displayName: string): Promise<AuthResult> => {
    try {
      const phone = normalizePhone(phoneNumber);
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: true,
          data: {
            phone_number: phone,
            display_name: displayName.trim() || `User ${phone.slice(-4)}`,
          },
        },
      });

      return error ? { success: false, error: error.message } : { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unable to send the email code.' };
    }
  };

  const verifyOTP = async (phoneNumber: string, email: string, code: string): Promise<AuthResult> => {
    try {
      const phone = normalizePhone(phoneNumber);
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code,
        type: 'email',
      });

      if (error || !data.session?.user) {
        return { success: false, error: error?.message || 'The verification code is invalid or expired.' };
      }

      const { error: activationError } = await supabase.rpc('activate_session');
      if (activationError) {
        await supabase.auth.signOut({ scope: 'local' });
        return { success: false, error: `Could not secure this device: ${activationError.message}` };
      }

      const { data: accountProfile, error: profileError } = await supabase
        .from('profiles')
        .select('id, phone_number, display_name, avatar_url, status, last_seen, role, account_status, suspension_reason, suspended_at')
        .eq('id', data.session.user.id)
        .single();

      if (profileError || !accountProfile) {
        await supabase.auth.signOut({ scope: 'local' });
        return { success: false, error: profileError?.message || 'Your profile could not be loaded.' };
      }

      if (normalizePhone(accountProfile.phone_number) !== phone) {
        await supabase.rpc('release_session');
        await supabase.auth.signOut({ scope: 'local' });
        return { success: false, error: 'That phone number is not associated with this email account.' };
      }

      setUser(data.session.user);
      setProfile(accountProfile as Profile);
      setSessionKickout(false);
      router.replace('/chat');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Verification failed.' };
    }
  };

  const logout = async () => {
    await supabase.rpc('release_session');
    await supabase.auth.signOut({ scope: 'local' });
    setUser(null);
    setProfile(null);
    router.replace('/login');
  };

  const updateProfile = async (displayName: string, status: string, avatarUrl?: string): Promise<AuthResult> => {
    if (!user) return { success: false, error: 'You are not signed in.' };

    const updates = {
      display_name: displayName.trim(),
      status: status.trim(),
      avatar_url: avatarUrl?.trim() || null,
      last_seen: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select('id, phone_number, display_name, avatar_url, status, last_seen, role, account_status, suspension_reason, suspended_at')
      .single();

    if (error) return { success: false, error: error.message };
    setProfile(data as Profile);
    return { success: true };
  };

  const changeEmail = async (email: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.updateUser({ email: email.trim().toLowerCase() });
    return error ? { success: false, error: error.message } : { success: true };
  };

  const changePhone = async (phone: string): Promise<AuthResult> => {
    if (!user) return { success: false, error: 'You are not signed in.' };
    const normalized = normalizePhone(phone);
    const { error } = await supabase.rpc('change_phone_number', { new_phone: normalized });
    if (error) return { success: false, error: error.message };
    setProfile((current) => current ? { ...current, phone_number: normalized } : current);
    return { success: true };
  };

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      loading,
      sessionKickout,
      sendOTP,
      verifyOTP,
      logout,
      updateProfile,
      changeEmail,
      changePhone,
      resetKickout: () => setSessionKickout(false),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
