import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. 3SChat requires a real Supabase project.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export interface Profile {
  id: string;
  phone_number: string;
  email?: string;
  display_name: string;
  avatar_url: string | null;
  status: string;
  last_seen: string;
  role: 'user' | 'moderator' | 'admin';
  account_status: 'active' | 'suspended';
  suspension_reason?: string | null;
  suspended_at?: string | null;
}

export interface Chat {
  id: string;
  name: string;
  is_group: boolean;
  created_at: string;
  updated_at?: string;
  participants?: Profile[];
  is_favorite?: boolean;
  is_locked?: boolean;
  is_self?: boolean;
  unread_count?: number;
  last_message?: string | null;
  is_blocked?: boolean;
  is_archived?: boolean;
  member_role?: 'owner' | 'admin' | 'member';
  encryption_enabled?: boolean;
  encryption_salt?: string | null;
}

export type MessageType = 'text' | 'image' | 'voice' | 'file';

export interface MessageReaction {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface MessageReceipt {
  message_id: string;
  user_id: string;
  delivered_at: string;
  read_at: string | null;
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string | null;
  message_type: MessageType;
  media_path: string | null;
  media_mime_type: string | null;
  media_size: number | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
  is_read: boolean;
  edited_at?: string | null;
  deleted_at?: string | null;
  is_pinned?: boolean;
  reactions?: MessageReaction[];
  receipts?: MessageReceipt[];
  media_url?: string;
  pending?: boolean;
  encrypted_content?: string | null;
  encryption_iv?: string | null;
  encryption_version?: number | null;
  decryption_failed?: boolean;
}

export interface Community {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  created_by: string;
  created_at: string;
}

export interface StatusUpdate {
  id: string;
  user_id: string;
  content: string | null;
  media_path: string | null;
  media_mime_type: string | null;
  created_at: string;
  expires_at: string;
  profiles?: Profile;
}

export interface UserSession {
  user_id: string;
  active_session_id: string;
  updated_at: string;
}

export function getSessionId(accessToken?: string): string | null {
  if (!accessToken) return null;

  try {
    const payload = accessToken.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const normalized = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(normalized));
    return typeof decoded.session_id === 'string' ? decoded.session_id : null;
  } catch {
    return null;
  }
}

export function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, '');
  return compact.startsWith('+') ? `+${compact.slice(1).replace(/\D/g, '')}` : `+${compact.replace(/\D/g, '')}`;
}

export function databaseErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [value.message, value.details, value.hint]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
    const prefix = typeof value.code === 'string' ? `[${value.code}] ` : '';
    if (parts.length) return `${prefix}${parts.join(' — ')}`;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
