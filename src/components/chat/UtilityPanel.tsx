'use client';
/* eslint-disable @next/next/no-img-element -- profile and signed media URLs are dynamic */

import { useCallback, useEffect, useState } from 'react';
import { Clock3, Loader2, Phone, Plus, UsersRound, X } from 'lucide-react';
import { supabase, type Community, type Profile, type StatusUpdate } from '../../lib/supabaseClient';

type Mode = 'updates' | 'communities' | 'calls';

interface CallHistory {
  id: string;
  chat_id: string;
  call_type: string;
  status: string;
  started_at: string;
}

export function UtilityPanel({ mode, userId, onClose }: { mode: Mode; userId: string; onClose: () => void }) {
  const [updates, setUpdates] = useState<StatusUpdate[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [calls, setCalls] = useState<CallHistory[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    if (mode === 'updates') {
      const { data, error: queryError } = await supabase.from('status_updates').select('*, profiles(id, phone_number, display_name, avatar_url, status, last_seen, role, account_status)').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
      if (queryError) setError(queryError.message); else setUpdates((data || []).map((row) => ({ ...row, profiles: Array.isArray(row.profiles) ? row.profiles[0] : row.profiles })) as StatusUpdate[]);
    } else if (mode === 'communities') {
      const { data, error: queryError } = await supabase.from('communities').select('*').order('created_at', { ascending: false });
      if (queryError) setError(queryError.message); else setCommunities((data || []) as Community[]);
    } else {
      const { data, error: queryError } = await supabase.from('calls').select('id, chat_id, call_type, status, started_at').order('started_at', { ascending: false }).limit(50);
      if (queryError) setError(queryError.message); else setCalls((data || []) as CallHistory[]);
    }
    setBusy(false);
  }, [mode]);

  useEffect(() => { const timeout = setTimeout(() => void load(), 0); return () => clearTimeout(timeout); }, [load]);

  const createUpdate = async () => {
    const content = window.prompt('Share an update (visible for 24 hours)');
    if (!content?.trim()) return;
    const { error: insertError } = await supabase.from('status_updates').insert({ user_id: userId, content: content.trim() });
    if (insertError) setError(insertError.message); else await load();
  };

  const createCommunity = async () => {
    const name = window.prompt('Community name');
    if (!name?.trim()) return;
    const description = window.prompt('Community description (optional)') || '';
    const { error: createError } = await supabase.rpc('create_community', { community_name: name, community_description: description });
    if (createError) setError(createError.message); else await load();
  };

  return <div className="fixed inset-0 z-[70] flex justify-end bg-black/60 backdrop-blur-sm"><section className="h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-[#111614] p-5 shadow-2xl"><header className="mb-6 flex items-center justify-between"><div><h2 className="text-xl font-bold capitalize">{mode}</h2><p className="text-xs text-gray-500">Database-backed 3SChat {mode}</p></div><button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/10"><X className="h-5 w-5" /></button></header>{error && <div className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}{busy ? <Loader2 className="mx-auto mt-20 h-8 w-8 animate-spin text-blue-400" /> : mode === 'updates' ? <><button onClick={() => void createUpdate()} className="mb-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient py-3 font-semibold"><Plus className="h-4 w-4" />New update</button><div className="space-y-3">{updates.length ? updates.map((update) => { const author = update.profiles as Profile | undefined; return <article key={update.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="mb-3 flex items-center gap-3"><img src={author?.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${update.user_id}`} alt="" className="h-10 w-10 rounded-full" /><div><p className="font-semibold">{author?.display_name || 'User'}</p><p className="text-xs text-gray-500">{new Date(update.created_at).toLocaleString()}</p></div></div><p className="whitespace-pre-wrap text-sm">{update.content}</p></article>; }) : <Empty icon={Clock3} text="No active updates." />}</div></> : mode === 'communities' ? <><button onClick={() => void createCommunity()} className="mb-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient py-3 font-semibold"><Plus className="h-4 w-4" />Create community</button><div className="space-y-3">{communities.length ? communities.map((community) => <article key={community.id} className="rounded-2xl border border-white/10 p-4"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/15"><UsersRound className="h-5 w-5 text-blue-300" /></div><div><p className="font-semibold">{community.name}</p><p className="text-xs text-gray-500">{community.description || 'Community announcements'}</p></div></div></article>) : <Empty icon={UsersRound} text="No communities yet." />}</div></> : <div className="space-y-3">{calls.length ? calls.map((call) => <article key={call.id} className="flex items-center justify-between rounded-xl border border-white/10 p-4"><div className="flex items-center gap-3"><Phone className="h-5 w-5 text-blue-300" /><div><p className="text-sm font-semibold capitalize">{call.call_type} call</p><p className="text-xs text-gray-500">{new Date(call.started_at).toLocaleString()}</p></div></div><span className="rounded-full bg-white/5 px-2 py-1 text-xs capitalize text-gray-300">{call.status}</span></article>) : <Empty icon={Phone} text="No call history. Start a call from a conversation header." />}</div>}</section></div>;
}

function Empty({ icon: Icon, text }: { icon: typeof Clock3; text: string }) {
  return <div className="py-16 text-center text-gray-500"><Icon className="mx-auto mb-3 h-8 w-8" /><p className="text-sm">{text}</p></div>;
}
