'use client';
/* eslint-disable @next/next/no-img-element -- private signed media URLs and profile avatars are dynamic */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CircleDashed,
  Clock3,
  Image as ImageIcon,
  Loader2,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  Send,
  UsersRound,
  X,
} from 'lucide-react';
import { supabase, type Community, type Profile, type StatusUpdate } from '../../lib/supabaseClient';
import { compressImageForUpload, STATUS_IMAGE_MAX_BYTES, validateUploadSize } from '../../lib/media';

type Mode = 'updates' | 'communities' | 'calls';
type StatusScreen = 'empty' | 'text' | 'media' | 'view';

interface CallHistory {
  id: string;
  chat_id: string;
  call_type: string;
  status: string;
  started_at: string;
}

interface UtilityPanelProps {
  mode: Mode;
  userId: string;
  profile?: Profile | null;
  onClose: () => void;
}

export function UtilityPanel({ mode, userId, profile, onClose }: UtilityPanelProps) {
  if (mode === 'updates') {
    return <StatusWorkspace userId={userId} profile={profile} onClose={onClose} />;
  }

  return <SecondaryUtilityPanel mode={mode} onClose={onClose} />;
}

function StatusWorkspace({ userId, profile, onClose }: { userId: string; profile?: Profile | null; onClose: () => void }) {
  const [updates, setUpdates] = useState<StatusUpdate[]>([]);
  const [busy, setBusy] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [screen, setScreen] = useState<StatusScreen>('empty');
  const [text, setText] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [selectedUpdate, setSelectedUpdate] = useState<StatusUpdate | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadUpdates = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('status_updates')
      .select('id, user_id, content, media_path, media_mime_type, created_at, expires_at, profiles(id, phone_number, display_name, avatar_url, status, last_seen, role, account_status)')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(300);

    if (queryError) {
      setError(queryError.message);
      setBusy(false);
      return [];
    }

    const mediaPaths = Array.from(new Set((data || []).map((row) => row.media_path).filter((path): path is string => !!path)));
    const signedUrls = new Map<string, string>();
    if (mediaPaths.length) {
      const { data: signedData } = await supabase.storage.from('status-media').createSignedUrls(mediaPaths, 3600);
      for (const signed of signedData || []) if (signed.path && signed.signedUrl) signedUrls.set(signed.path, signed.signedUrl);
    }

    const hydrated = (data || []).map((row) => {
      const update = {
        ...row,
        profiles: Array.isArray(row.profiles) ? row.profiles[0] : row.profiles,
      } as StatusUpdate;
      if (update.media_path) update.media_url = signedUrls.get(update.media_path);
      return update;
    });
    setUpdates(hydrated);
    setSelectedUpdate((current) => current ? hydrated.find((entry) => entry.id === current.id) || null : null);
    setBusy(false);
    return hydrated;
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void loadUpdates(), 0);
    const channel = supabase
      .channel(`status-workspace-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'status_updates' }, () => void loadUpdates())
      .subscribe();
    return () => {
      clearTimeout(timeout);
      void supabase.removeChannel(channel);
    };
  }, [loadUpdates, userId]);

  useEffect(() => () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
  }, [mediaPreview]);

  const resetComposer = () => {
    setText('');
    setMediaFile(null);
    setMediaPreview(null);
    setSelectedUpdate(null);
    setScreen('empty');
  };

  const startTextUpdate = () => {
    setShowCreateMenu(false);
    setSelectedUpdate(null);
    setText('');
    setScreen('text');
  };

  const selectMedia = async (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Choose a JPEG, PNG, WebP, or GIF image. Video statuses are disabled on the free tier.');
      return;
    }
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('The original image must be 10 MB or smaller before optimization.');
      const optimized = await compressImageForUpload(file);
      validateUploadSize(optimized, STATUS_IMAGE_MAX_BYTES, 'Status image');
      if (mediaPreview) URL.revokeObjectURL(mediaPreview);
      setError(null);
      setShowCreateMenu(false);
      setSelectedUpdate(null);
      setMediaFile(optimized);
      setMediaPreview(URL.createObjectURL(optimized));
      setText('');
      setScreen('media');
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'Unable to prepare that image.');
    }
  };

  const publishUpdate = async () => {
    if (publishing || (screen === 'text' && !text.trim()) || (screen === 'media' && !mediaFile)) return;
    setPublishing(true);
    setError(null);
    let uploadedPath: string | null = null;

    try {
      if (mediaFile) {
        const extension = mediaFile.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
        uploadedPath = `${userId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('status-media')
          .upload(uploadedPath, mediaFile, { contentType: mediaFile.type, upsert: false });
        if (uploadError) throw uploadError;
      }

      const { data, error: insertError } = await supabase
        .from('status_updates')
        .insert({
          user_id: userId,
          content: text.trim() || null,
          media_path: uploadedPath,
          media_mime_type: mediaFile?.type || null,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;

      resetComposer();
      const refreshed = await loadUpdates();
      const created = refreshed.find((entry) => entry.id === data.id);
      if (created) {
        setSelectedUpdate(created);
        setScreen('view');
      }
    } catch (publishError) {
      if (uploadedPath) await supabase.storage.from('status-media').remove([uploadedPath]);
      setError(publishError instanceof Error ? publishError.message : 'Unable to publish your status.');
    } finally {
      setPublishing(false);
    }
  };

  const openUpdate = (update: StatusUpdate) => {
    setShowCreateMenu(false);
    setSelectedUpdate(update);
    setScreen('view');
  };

  const ownUpdates = updates.filter((entry) => entry.user_id === userId);
  const otherUpdates = updates.filter((entry) => entry.user_id !== userId);
  const avatar = profile?.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${userId}`;

  return (
    <div className="fixed inset-0 z-[70] bg-[#101312] text-white">
      <div className="grid h-full grid-cols-1 md:grid-cols-[410px_minmax(0,1fr)]">
        <aside className="relative z-10 flex min-h-0 flex-col border-r border-white/10 bg-[#111514]">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/5 px-5">
            <h2 className="text-xl font-bold">Status</h2>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setShowCreateMenu((value) => !value)} className="rounded-full p-2 transition hover:bg-white/10" aria-label="Create status"><Plus className="h-5 w-5" /></button>
              <button type="button" className="rounded-full p-2 text-gray-300 transition hover:bg-white/10" aria-label="Status options"><MoreVertical className="h-5 w-5" /></button>
              <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-300 transition hover:bg-white/10" aria-label="Close status"><X className="h-5 w-5" /></button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {error && <div className="mb-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
            <div className="relative">
              <button type="button" onClick={() => setShowCreateMenu((value) => !value)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-white/5">
                <span className="relative shrink-0">
                  <img src={avatar} alt="Your profile" className="h-12 w-12 rounded-full object-cover" />
                  <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-[#111514] bg-emerald-500"><Plus className="h-3 w-3" /></span>
                </span>
                <span><strong className="block text-sm">My status</strong><span className="text-xs text-gray-400">Click to add status update</span></span>
              </button>

              {showCreateMenu && (
                <div className="ml-14 mt-1 w-48 overflow-hidden rounded-2xl border border-white/10 bg-[#171b1a] p-1 shadow-2xl">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm hover:bg-white/10"><ImageIcon className="h-4 w-4" />Photo</button>
                  <button type="button" onClick={startTextUpdate} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm hover:bg-white/10"><Pencil className="h-4 w-4" />Text</button>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => { void selectMedia(event.target.files?.[0]); event.target.value = ''; }} />
            </div>

            {ownUpdates.length > 0 && <StatusSection title="My updates" updates={ownUpdates} onOpen={openUpdate} />}
            {otherUpdates.length > 0 && <StatusSection title="Recent" updates={otherUpdates} onOpen={openUpdate} />}
            {!busy && updates.length === 0 && <p className="mt-8 px-3 text-xs text-gray-500">New updates from your contacts will appear here.</p>}
            {busy && <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-blue-400" />}
          </div>
        </aside>

        <main className="relative hidden min-w-0 items-center justify-center bg-[#121514] md:flex">
          {screen === 'empty' && <StatusEmpty />}

          {screen === 'text' && (
            <div className="flex h-full w-full flex-col bg-gradient-to-br from-[#315b7c] via-[#734876] to-[#bd5b60]">
              <ComposerHeader title="Text status" onBack={resetComposer} />
              <div className="flex min-h-0 flex-1 items-center justify-center p-8">
                <textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} placeholder="Type a status" className="h-52 w-full max-w-3xl resize-none bg-transparent text-center text-4xl font-medium leading-snug text-white outline-none placeholder:text-white/50" />
              </div>
              <ComposerFooter text={text} setText={setText} publishing={publishing} disabled={!text.trim()} onPublish={() => void publishUpdate()} />
            </div>
          )}

          {screen === 'media' && mediaPreview && mediaFile && (
            <div className="flex h-full w-full flex-col bg-black">
              <ComposerHeader title="New status" onBack={resetComposer} />
              <div className="flex min-h-0 flex-1 items-center justify-center p-5">
                <img src={mediaPreview} alt="Status preview" className="max-h-full max-w-full rounded-lg object-contain" />
              </div>
              <ComposerFooter text={text} setText={setText} publishing={publishing} disabled={false} placeholder="Add a caption" onPublish={() => void publishUpdate()} />
            </div>
          )}

          {screen === 'view' && selectedUpdate && <StatusViewer update={selectedUpdate} onClose={resetComposer} />}
        </main>

        {(screen === 'text' || screen === 'media' || screen === 'view') && (
          <div className="fixed inset-0 z-20 flex bg-[#121514] md:hidden">
            {screen === 'view' && selectedUpdate
              ? <StatusViewer update={selectedUpdate} onClose={resetComposer} />
              : screen === 'text'
                ? <div className="flex h-full w-full flex-col bg-gradient-to-br from-[#315b7c] via-[#734876] to-[#bd5b60]"><ComposerHeader title="Text status" onBack={resetComposer} /><textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} placeholder="Type a status" className="min-h-0 flex-1 resize-none bg-transparent p-8 text-center text-3xl outline-none placeholder:text-white/50" /><ComposerFooter text={text} setText={setText} publishing={publishing} disabled={!text.trim()} onPublish={() => void publishUpdate()} /></div>
                : mediaPreview && mediaFile
                  ? <div className="flex h-full w-full flex-col bg-black"><ComposerHeader title="New status" onBack={resetComposer} /><div className="flex min-h-0 flex-1 items-center justify-center p-3"><img src={mediaPreview} alt="Status preview" className="max-h-full max-w-full object-contain" /></div><ComposerFooter text={text} setText={setText} publishing={publishing} disabled={false} placeholder="Add a caption" onPublish={() => void publishUpdate()} /></div>
                  : null}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusSection({ title, updates, onOpen }: { title: string; updates: StatusUpdate[]; onOpen: (update: StatusUpdate) => void }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</h3>
      <div className="space-y-1">
        {updates.map((update) => {
          const author = update.profiles;
          return (
            <button key={update.id} type="button" onClick={() => onOpen(update)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-white/5">
              <span className="rounded-full bg-gradient-to-br from-blue-400 via-fuchsia-500 to-red-400 p-[2px]"><img src={author?.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${update.user_id}`} alt="" className="h-11 w-11 rounded-full border-2 border-[#111514] object-cover" /></span>
              <span className="min-w-0"><strong className="block truncate text-sm">{author?.display_name || 'User'}</strong><span className="block truncate text-xs text-gray-400">{formatStatusTime(update.created_at)}{update.content ? ` · ${update.content}` : ''}</span></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StatusEmpty() {
  return (
    <div className="max-w-xl px-6 text-center">
      <CircleDashed className="mx-auto mb-7 h-14 w-14 text-gray-600" />
      <h3 className="text-3xl font-normal">Share status updates</h3>
      <p className="mt-3 text-base text-gray-400">Share photos and text that disappear after 24 hours.</p>
    </div>
  );
}

function ComposerHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 bg-black/20 px-5"><button type="button" onClick={onBack} className="rounded-full p-2 hover:bg-white/10"><X className="h-5 w-5" /></button><strong>{title}</strong></header>;
}

function ComposerFooter({ text, setText, publishing, disabled, onPublish, placeholder = 'Add a caption' }: { text: string; setText: (value: string) => void; publishing: boolean; disabled: boolean; onPublish: () => void; placeholder?: string }) {
  return (
    <footer className="flex shrink-0 items-center gap-3 border-t border-white/10 bg-black/25 p-4">
      <input value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} placeholder={placeholder} className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/10 px-5 py-3 text-sm outline-none placeholder:text-white/50 focus:border-blue-400/60" />
      <button type="button" onClick={onPublish} disabled={publishing || disabled} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Publish status">{publishing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}</button>
    </footer>
  );
}

function StatusViewer({ update, onClose }: { update: StatusUpdate; onClose: () => void }) {
  const author = update.profiles;
  const isVideo = update.media_mime_type?.startsWith('video/');
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#0b0d0c]">
      <div className="absolute inset-x-0 top-0 z-10 h-1 bg-white/20"><div className="h-full w-full bg-white" /></div>
      <header className="relative z-10 flex h-20 shrink-0 items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-5 pt-2">
        <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
        <img src={author?.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${update.user_id}`} alt="" className="h-10 w-10 rounded-full object-cover" />
        <div><strong className="block text-sm">{author?.display_name || 'User'}</strong><span className="text-xs text-white/60">{formatStatusTime(update.created_at)}</span></div>
      </header>
      <div className={`flex min-h-0 flex-1 items-center justify-center ${update.media_url ? 'bg-black' : 'bg-gradient-to-br from-[#315b7c] via-[#734876] to-[#bd5b60]'} p-6`}>
        {update.media_url
          ? isVideo
            ? <video src={update.media_url} controls autoPlay className="max-h-full max-w-full" />
            : <img src={update.media_url} alt="Status update" className="max-h-full max-w-full object-contain" />
          : <p className="max-w-4xl whitespace-pre-wrap text-center text-4xl font-medium leading-snug">{update.content}</p>}
      </div>
      {update.media_url && update.content && <p className="shrink-0 bg-black px-6 py-5 text-center text-base">{update.content}</p>}
    </div>
  );
}

function SecondaryUtilityPanel({ mode, onClose }: { mode: Exclude<Mode, 'updates'>; onClose: () => void }) {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [calls, setCalls] = useState<CallHistory[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCommunityForm, setShowCommunityForm] = useState(false);
  const [communityName, setCommunityName] = useState('');
  const [communityDescription, setCommunityDescription] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    if (mode === 'communities') {
      const { data, error: queryError } = await supabase.from('communities').select('id, name, description, avatar_url, created_by, created_at').order('created_at', { ascending: false }).limit(100);
      if (queryError) setError(queryError.message); else setCommunities((data || []) as Community[]);
    } else {
      const { data, error: queryError } = await supabase.from('calls').select('id, chat_id, call_type, status, started_at').order('started_at', { ascending: false }).limit(50);
      if (queryError) setError(queryError.message); else setCalls((data || []) as CallHistory[]);
    }
    setBusy(false);
  }, [mode]);

  useEffect(() => { const timeout = setTimeout(() => void load(), 0); return () => clearTimeout(timeout); }, [load]);

  const createCommunity = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!communityName.trim()) return;
    const { error: createError } = await supabase.rpc('create_community', { community_name: communityName.trim(), community_description: communityDescription.trim() });
    if (createError) setError(createError.message);
    else {
      setCommunityName('');
      setCommunityDescription('');
      setShowCommunityForm(false);
      await load();
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/60 backdrop-blur-sm">
      <section className="h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-[#111614] p-5 shadow-2xl">
        <header className="mb-6 flex items-center justify-between"><div><h2 className="text-xl font-bold capitalize">{mode}</h2><p className="text-xs text-gray-500">Database-backed 3SChat {mode}</p></div><button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/10"><X className="h-5 w-5" /></button></header>
        {error && <div className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
        {busy ? <Loader2 className="mx-auto mt-20 h-8 w-8 animate-spin text-blue-400" /> : mode === 'communities' ? <>
          <button type="button" onClick={() => setShowCommunityForm((value) => !value)} className="mb-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient py-3 font-semibold"><Plus className="h-4 w-4" />Create community</button>
          {showCommunityForm && <form onSubmit={createCommunity} className="mb-5 space-y-3 rounded-2xl border border-white/10 p-4"><input autoFocus value={communityName} onChange={(event) => setCommunityName(event.target.value)} placeholder="Community name" maxLength={100} className="glass-input w-full rounded-xl px-4 py-3" /><textarea value={communityDescription} onChange={(event) => setCommunityDescription(event.target.value)} placeholder="Description (optional)" maxLength={500} className="glass-input w-full resize-none rounded-xl px-4 py-3" /><button className="w-full rounded-xl bg-blue-500 py-2 font-semibold">Create</button></form>}
          <div className="space-y-3">{communities.length ? communities.map((community) => <article key={community.id} className="rounded-2xl border border-white/10 p-4"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/15"><UsersRound className="h-5 w-5 text-blue-300" /></div><div><p className="font-semibold">{community.name}</p><p className="text-xs text-gray-500">{community.description || 'Community announcements'}</p></div></div></article>) : <Empty icon={UsersRound} text="No communities yet." />}</div>
        </> : <div className="space-y-3">{calls.length ? calls.map((call) => <article key={call.id} className="flex items-center justify-between rounded-xl border border-white/10 p-4"><div className="flex items-center gap-3"><Phone className="h-5 w-5 text-blue-300" /><div><p className="text-sm font-semibold capitalize">{call.call_type} call</p><p className="text-xs text-gray-500">{new Date(call.started_at).toLocaleString()}</p></div></div><span className="rounded-full bg-white/5 px-2 py-1 text-xs capitalize text-gray-300">{call.status}</span></article>) : <Empty icon={Phone} text="No call history. Start a call from a conversation header." />}</div>}
      </section>
    </div>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof Clock3; text: string }) {
  return <div className="py-16 text-center text-gray-500"><Icon className="mx-auto mb-3 h-8 w-8" /><p className="text-sm">{text}</p></div>;
}

function formatStatusTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return `${sameDay ? 'Today' : date.toLocaleDateString()}, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
