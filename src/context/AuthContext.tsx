'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  supabase, 
  IS_MOCK_MODE, 
  mockAuth, 
  mockDb, 
  mockRealtime, 
  Profile, 
  UserSession 
} from '../lib/supabaseClient';

interface AuthContextType {
  user: any | null;
  profile: Profile | null;
  loading: boolean;
  sessionKickout: boolean;
  sendOTP: (phoneNumber: string) => Promise<{ success: boolean; otp?: string; error?: string }>;
  verifyOTP: (phoneNumber: string, code: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateProfile: (displayName: string, status: string, avatarUrl?: string) => Promise<{ success: boolean; error?: string }>;
  resetKickout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [sessionKickout, setSessionKickout] = useState<boolean>(false);
  const [deviceId, setDeviceId] = useState<string>('');
  const router = useRouter();

  // 1. Generate/retrieve unique deviceId on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      let id = localStorage.getItem('3schat_device_id');
      if (!id) {
        id = `device-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`;
        localStorage.setItem('3schat_device_id', id);
      }
      setDeviceId(id);
    }
  }, []);

  // 2. Main initialization
  useEffect(() => {
    if (!deviceId) return; // Wait for deviceId to load

    const initializeAuth = async () => {
      try {
        if (IS_MOCK_MODE) {
          const { data } = await mockAuth.getUser();
          if (data.user) {
            setUser(data.user);
            const prof = await mockDb.getProfile(data.user.id);
            setProfile(prof);
            
            // Check active session immediately
            const activeSess = await mockDb.getSession(data.user.id);
            if (activeSess && activeSess.active_device_id !== deviceId) {
              // Logged out on another device while away
              handleDeviceKickout();
              return;
            }
          }
        } else {
          // Real Supabase auth initial check
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            setUser(session.user);
            const { data: prof } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single();
            setProfile(prof);

            // Fetch session status
            const { data: activeSess } = await supabase
              .from('user_sessions')
              .select('*')
              .eq('user_id', session.user.id)
              .single();

            if (activeSess && activeSess.active_device_id !== deviceId) {
              handleDeviceKickout();
              return;
            }
          }
        }
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, [deviceId]);

  // 3. Realtime Listener for user_sessions
  useEffect(() => {
    if (!user || !deviceId) return;

    let unsubscribeFunc: (() => void) | null = null;

    const setupSessionListener = async () => {
      const userId = user.id;

      if (IS_MOCK_MODE) {
        const sub = mockRealtime.subscribe('user_sessions', userId, (payload: UserSession) => {
          if (payload.active_device_id !== deviceId) {
            handleDeviceKickout();
          }
        });
        unsubscribeFunc = sub.unsubscribe;
      } else {
        // Real Supabase Realtime channel setup
        const channel = supabase
          .channel(`session-${userId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'user_sessions',
              filter: `user_id=eq.${userId}`
            },
            (payload: any) => {
              const updatedSession = payload.new as UserSession;
              if (updatedSession.active_device_id !== deviceId) {
                handleDeviceKickout();
              }
            }
          )
          .subscribe();

        unsubscribeFunc = () => {
          supabase.removeChannel(channel);
        };
      }
    };

    setupSessionListener();

    return () => {
      if (unsubscribeFunc) unsubscribeFunc();
    };
  }, [user, deviceId]);

  const handleDeviceKickout = async () => {
    setSessionKickout(true);
    setUser(null);
    setProfile(null);
    if (IS_MOCK_MODE) {
      await mockAuth.signOut();
    } else {
      await supabase.auth.signOut();
    }
    router.push('/login');
  };

  const resetKickout = () => {
    setSessionKickout(false);
  };

  // Send OTP
  const sendOTP = async (phoneNumber: string) => {
    try {
      if (IS_MOCK_MODE) {
        const { data, error } = await mockAuth.signInWithOTP(phoneNumber);
        if (error) return { success: false, error: error.message };
        return { success: true, otp: data?.otp };
      } else {
        // Real Supabase phone OTP auth trigger
        const { error } = await supabase.auth.signInWithOtp({
          phone: phoneNumber,
        });
        if (error) return { success: false, error: error.message };
        return { success: true };
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'An unexpected error occurred.' };
    }
  };

  // Verify OTP
  const verifyOTP = async (phoneNumber: string, code: string) => {
    try {
      if (IS_MOCK_MODE) {
        const { data, error } = await mockAuth.verifyOTP(phoneNumber, code);
        if (error) return { success: false, error: error.message };
        
        const loggedInUser = data?.user;
        if (!loggedInUser) {
          return { success: false, error: 'Verification failed. User session not found.' };
        }
        setUser(loggedInUser);
        
        // Fetch profile
        const prof = await mockDb.getProfile(loggedInUser.id);
        setProfile(prof);

        // Lock active device ID in mockDB
        await mockDb.updateSession(loggedInUser.id, deviceId);
        
        router.push('/chat');
        return { success: true };
      } else {
        // Real Supabase OTP verification
        const { data: { session }, error } = await supabase.auth.verifyOtp({
          phone: phoneNumber,
          token: code,
          type: 'sms'
        });

        if (error || !session?.user) {
          return { success: false, error: error?.message || 'OTP verification failed' };
        }

        setUser(session.user);

        // Fetch or create profile using a timeout to let the DB trigger complete
        let prof = null;
        for (let i = 0; i < 5; i++) {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();
          if (data) {
            prof = data;
            break;
          }
          await new Promise((res) => setTimeout(res, 500));
        }

        setProfile(prof);

        // Enforce single session: Upsert active_device_id in user_sessions table
        const { error: sessionError } = await supabase
          .from('user_sessions')
          .upsert({
            user_id: session.user.id,
            active_device_id: deviceId,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });

        if (sessionError) {
          console.error('Session lock error:', sessionError);
        }

        router.push('/chat');
        return { success: true };
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'An unexpected error occurred.' };
    }
  };

  // Sign out
  const logout = async () => {
    try {
      if (IS_MOCK_MODE) {
        await mockAuth.signOut();
      } else {
        await supabase.auth.signOut();
      }
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      setProfile(null);
      router.push('/login');
    }
  };

  // Update Profile
  const updateProfile = async (displayName: string, status: string, avatarUrl?: string) => {
    if (!user) return { success: false, error: 'User is not logged in.' };

    try {
      const updates = {
        id: user.id,
        display_name: displayName,
        status,
        ...(avatarUrl && { avatar_url: avatarUrl }),
        last_seen: new Date().toISOString()
      };

      if (IS_MOCK_MODE) {
        const profiles = JSON.parse(localStorage.getItem('3schat_mock_profiles') || '[]');
        const updatedProfiles = profiles.map((p: Profile) => 
          p.id === user.id ? { ...p, ...updates } : p
        );
        localStorage.setItem('3schat_mock_profiles', JSON.stringify(updatedProfiles));
        setProfile({ ...profile, ...updates } as Profile);
        return { success: true };
      } else {
        const { error } = await supabase
          .from('profiles')
          .upsert(updates);

        if (error) return { success: false, error: error.message };
        setProfile({ ...profile, ...updates } as Profile);
        return { success: true };
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Profile update failed' };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        sessionKickout,
        sendOTP,
        verifyOTP,
        logout,
        updateProfile,
        resetKickout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
