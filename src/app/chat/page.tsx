'use client';
/* eslint-disable @next/next/no-img-element -- private signed URLs and user-provided avatar URLs are dynamic */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Archive,
  BadgePlus,
  CircleDashed,
  Image as ImageIcon,
  LockKeyhole,
  LogOut, 
  MessageCircle,
  Settings, 
  Search, 
  Send, 
  MessageSquarePlus, 
  ArrowLeft, 
  ShieldCheck, 
  Smile, 
  CheckCheck, 
  MessageSquare,
  Mic,
  MoreVertical,
  PanelTop,
  Phone,
  Pin,
  Plus,
  Loader2,
  UsersRound,
  X,
  Sparkles,
  StopCircle,
  Paperclip
} from 'lucide-react';
import { 
  supabase, 
  Profile, 
  Chat, 
  Message,
  MessageReaction,
  MessageType,
} from '../../lib/supabaseClient';

const EMOJIS = ['😀', '😂', '😍', '👍', '❤️', '🔥', '🎉', '😮'];
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

export default function ChatPage() {
  const { user, profile, logout, updateProfile, loading } = useAuth();
  const router = useRouter();

  // Navigation / Panel states
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  
  // UI toggles
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [showSettings, setShowSettings] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Input states
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newChatSearch, setNewChatSearch] = useState('');
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editAvatar, setEditAvatar] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedRef = useRef(0);

  // 1. Guard route: redirect if logged out
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // 2. Fetch chats list and other profiles
  const fetchChatsAndProfiles = async () => {
    if (!user) return;
    try {
      const { data: participantsData, error: cpError } = await supabase
        .from('chat_participants')
        .select('chat_id')
        .eq('user_id', user.id);
      if (cpError) throw cpError;

      const chatIds = (participantsData || []).map((participant) => participant.chat_id);
      if (chatIds.length) {
        const { data: chatsData, error: chatsError } = await supabase
          .from('chats')
          .select('*, chat_participants(user_id, profiles(*))')
          .in('id', chatIds)
          .order('updated_at', { ascending: false });
        if (chatsError) throw chatsError;

        const formattedChats = (chatsData || []).map((chat) => {
          const rows = chat.chat_participants as unknown as Array<{ user_id: string; profiles: Profile | Profile[] }>;
          const listParticipants = rows
            .filter((participant) => participant.user_id !== user.id)
            .flatMap((participant) => Array.isArray(participant.profiles) ? participant.profiles : [participant.profiles])
            .filter(Boolean);
          return {
            id: chat.id,
            name: chat.is_group ? (chat.name || 'Group') : (listParticipants[0]?.display_name || 'Direct chat'),
            is_group: chat.is_group,
            created_at: chat.created_at,
            updated_at: chat.updated_at,
            participants: listParticipants,
          } as Chat;
        });
        setChats(formattedChats);
      } else {
        setChats([]);
      }

      const { data: allProfiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, phone_number, display_name, avatar_url, status, last_seen')
        .neq('id', user.id)
        .order('display_name');
      if (profilesError) throw profilesError;
      setProfiles((allProfiles || []) as Profile[]);
    } catch (err) {
      console.error('Error fetching chats/profiles:', err);
      setActionError(err instanceof Error ? err.message : 'Unable to load conversations.');
    }
  };

  useEffect(() => {
    if (!user) return;
    const timeout = setTimeout(() => void fetchChatsAndProfiles(), 0);
    return () => clearTimeout(timeout);
    // Fetchers intentionally use the latest authenticated user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 3. Fetch messages for active chat
  const fetchMessages = async (chatId: string) => {
    try {
      const { error: readError } = await supabase.rpc('mark_chat_read', { target_chat_id: chatId });
      if (readError) throw readError;
      const { data, error } = await supabase
        .from('messages')
        .select('*, message_reactions(*)')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });
      if (error) throw error;

      const hydrated = await Promise.all((data || []).map(async (row) => {
        const message = { ...row, reactions: row.message_reactions || [] } as Message & { message_reactions?: MessageReaction[] };
        if (message.media_path) {
          const { data: signed } = await supabase.storage.from('chat-media').createSignedUrl(message.media_path, 3600);
          message.media_url = signed?.signedUrl;
        }
        delete message.message_reactions;
        return message;
      }));
      setMessages(hydrated);
      scrollToBottom();
    } catch (err) {
      console.error('Error fetching messages:', err);
      setActionError(err instanceof Error ? err.message : 'Unable to load messages.');
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (activeChat) void fetchMessages(activeChat.id);
      else setMessages([]);
    }, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat]);

  useEffect(() => {
    if (activeChat || !chats.length) return;
    const timeout = setTimeout(() => setActiveChat(chats[0]), 0);
    return () => clearTimeout(timeout);
  }, [activeChat, chats]);

  // 4. Realtime subscriber for new messages
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`chat-events-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        const newMessage = payload.new as Message;
        if (activeChat && newMessage.chat_id === activeChat.id) void fetchMessages(activeChat.id);
        void fetchChatsAndProfiles();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => {
        if (activeChat) void fetchMessages(activeChat.id);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // Re-subscribe only when the authenticated user or selected chat changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeChat]);

  // 5. Send message action
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChat || !user) return;

    const textToSend = inputText;
    setInputText('');

    try {
      const { error } = await supabase.from('messages').insert({
        chat_id: activeChat.id,
        sender_id: user.id,
        content: textToSend.trim(),
        message_type: 'text',
      });
      if (error) throw error;
      await fetchMessages(activeChat.id);
      await fetchChatsAndProfiles();
    } catch (err) {
      console.error('Failed to send message:', err);
      setInputText(textToSend);
      setActionError(err instanceof Error ? err.message : 'Message could not be sent.');
    }
  };

  // 6. Start new chat action
  const handleStartChat = async (targetUser: Profile) => {
    if (!user) return;

    try {
      const { data: chatId, error } = await supabase.rpc('create_direct_chat', { target_user_id: targetUser.id });
      if (error || !chatId) throw error || new Error('The conversation could not be created.');
      const chatDetails: Chat = {
        id: chatId,
        name: targetUser.display_name,
        is_group: false,
        created_at: new Date().toISOString(),
        participants: [targetUser],
      };
      setActiveChat(chatDetails);
      setShowNewChatModal(false);
      setMobileView('chat');
      await fetchChatsAndProfiles();
    } catch (err) {
      console.error('Failed to start chat:', err);
      setActionError(err instanceof Error ? err.message : 'Conversation could not be started.');
    }
  };

  const uploadMediaMessage = async (file: File, messageType: MessageType, durationSeconds?: number) => {
    if (!activeChat || !user) return;
    if (file.size > MAX_MEDIA_BYTES) throw new Error('Media must be smaller than 15 MB.');

    setIsUploading(true);
    setActionError(null);
    const extension = (file.name.split('.').pop() || (messageType === 'voice' ? 'webm' : 'bin'))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const path = `${activeChat.id}/${user.id}/${crypto.randomUUID()}.${extension}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: messageError } = await supabase.from('messages').insert({
        chat_id: activeChat.id,
        sender_id: user.id,
        content: messageType === 'image' ? file.name : null,
        message_type: messageType,
        media_path: path,
        media_mime_type: file.type,
        media_size: file.size,
        duration_seconds: durationSeconds || null,
      });
      if (messageError) {
        await supabase.storage.from('chat-media').remove([path]);
        throw messageError;
      }

      await fetchMessages(activeChat.id);
      await fetchChatsAndProfiles();
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setActionError('Choose a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    try {
      await uploadMediaMessage(file, 'image');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The image could not be sent.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
  };

  const startRecording = async () => {
    if (!activeChat || !user) return;
    setActionError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setActionError('Voice recording is not supported by this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingStartedRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        const duration = Math.max(1, Math.round((Date.now() - recordingStartedRef.current) / 1000));
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
        if (!blob.size) return;
        try {
          await uploadMediaMessage(new File([blob], `voice-${Date.now()}.${extension}`, { type: mimeType }), 'voice', duration);
        } catch (error) {
          setActionError(error instanceof Error ? error.message : 'The voice message could not be sent.');
        }
      };
      recorder.start(250);
      setIsRecording(true);
    } catch (error) {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      setActionError(error instanceof Error ? error.message : 'Microphone permission was not granted.');
    }
  };

  const toggleReaction = async (message: Message, emoji: string) => {
    if (!user) return;
    setReactingTo(null);
    const exists = message.reactions?.some((reaction) => reaction.user_id === user.id && reaction.emoji === emoji);
    const query = supabase.from('message_reactions');
    const { error } = exists
      ? await query.delete().eq('message_id', message.id).eq('user_id', user.id).eq('emoji', emoji)
      : await query.insert({ message_id: message.id, user_id: user.id, emoji });
    if (error) setActionError(error.message);
    else if (activeChat) await fetchMessages(activeChat.id);
  };

  useEffect(() => () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  // 7. Update profile action
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingProfile(true);
    const res = await updateProfile(editName, editStatus, editAvatar);
    setIsUpdatingProfile(false);
    if (res.success) {
      setShowSettings(false);
    } else {
      alert(res.error || 'Failed to update profile.');
    }
  };

  // Filters
  const filteredChats = chats.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredProfiles = profiles.filter((p) =>
    p.display_name?.toLowerCase().includes(newChatSearch.toLowerCase()) ||
    p.phone_number?.includes(newChatSearch)
  );

  const filterPills = [
    { label: 'All', active: true },
    { label: 'Unread 1', active: false },
    { label: 'Favorites', active: false },
    { label: 'Groups', active: false }
  ];

  const bottomNavItems = [
    { label: 'Chats', icon: MessageCircle, active: true, badge: 1 },
    { label: 'Updates', icon: CircleDashed, active: false },
    { label: 'Communities', icon: UsersRound, active: false },
    { label: 'Calls', icon: Phone, active: false }
  ];

  const railItems = [
    { label: 'Chats', icon: MessageCircle, active: true, badge: 1 },
    { label: 'Updates', icon: CircleDashed, active: false },
    { label: 'Calls', icon: Phone, active: false, dot: true },
    { label: 'Communities', icon: UsersRound, active: false }
  ];

  const openProfileSettings = () => {
    setEditName(profile?.display_name || '');
    setEditStatus(profile?.status || '');
    setEditAvatar(profile?.avatar_url || '');
    setShowSettings(true);
  };

  const formatChatTime = (date?: string) =>
    date ? new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#0d0e12] flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
          <p className="text-gray-400 font-medium">Restoring chat sessions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#111614] text-[#e9edef]">
      {/* Main chat frame */}
      <div className="relative z-10 flex h-full w-full overflow-hidden bg-[#111614]">
        <aside className="hidden w-[64px] shrink-0 flex-col items-center justify-between border-r border-black/40 bg-[#202624] py-3 md:flex">
          <div className="flex w-full flex-col items-center gap-3">
            {railItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  title={item.label}
                  className={`relative grid h-11 w-11 place-items-center rounded-full transition ${
                    item.active ? 'bg-[#2f3734] text-white' : 'text-[#aebac1] hover:bg-[#2a302e] hover:text-white'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {item.badge && (
                    <span className="absolute -right-0.5 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-gradient-to-r from-blue-500 to-red-500 px-1 text-[11px] font-bold text-white">
                      {item.badge}
                    </span>
                  )}
                  {item.dot && (
                    <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-gradient-to-r from-blue-500 to-red-500 ring-2 ring-[#202624]" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex w-full flex-col items-center gap-3">
            <button
              type="button"
              title="Archived"
              className="grid h-11 w-11 place-items-center rounded-full text-[#aebac1] transition hover:bg-[#2a302e] hover:text-white"
            >
              <Archive className="h-5 w-5" />
            </button>
            <button
              type="button"
              title="Settings"
              onClick={openProfileSettings}
              className="grid h-11 w-11 place-items-center rounded-full text-[#aebac1] transition hover:bg-[#2a302e] hover:text-white"
            >
              <Settings className="h-5 w-5" />
            </button>
            <button
              type="button"
              title="Sign out"
              onClick={() => void logout()}
              className="grid h-11 w-11 place-items-center rounded-full text-[#aebac1] transition hover:bg-red-500/10 hover:text-red-300"
            >
              <LogOut className="h-5 w-5" />
            </button>
            <button
              type="button"
              title="Edit profile"
              onClick={openProfileSettings}
              className="relative h-10 w-10 overflow-hidden rounded-full ring-2 ring-transparent transition hover:ring-blue-500/70"
            >
              <img
                src={profile?.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=fallback'}
                alt="Edit profile"
                className="h-full w-full object-cover"
              />
            </button>
          </div>
        </aside>

        
        {/* ========================================================= */}
        {/* SIDEBAR (CHATS LIST)                                      */}
        {/* ========================================================= */}
        <div 
          className={`relative w-full shrink-0 border-r border-black/40 bg-[#111614] md:w-[410px] flex flex-col h-full transition-all duration-300 ${
            mobileView === 'chat' ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* Sidebar Header */}
          <div className="px-4 pb-3 pt-5">
            <div className="mb-5 flex items-center justify-between">
              <h1 className="text-2xl font-bold leading-none text-white">3SChat</h1>

              <div className="flex items-center gap-4 text-[#aebac1]">
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(true)}
                  title="New chat"
                  className="rounded-full p-1.5 transition hover:bg-[#2a302e] hover:text-white cursor-pointer"
                >
                  <PanelTop className="h-5 w-5" />
                </button>
                <button 
                  onClick={openProfileSettings}
                  title="Edit profile"
                  className="rounded-full p-1.5 transition hover:bg-[#2a302e] hover:text-white cursor-pointer"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute inset-y-0 left-4 my-auto h-4 w-4 text-[#8696a0]" />
              <input 
                type="text"
                placeholder="Search or start a new chat"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-full border border-transparent bg-[#202c2f] pl-12 pr-4 text-sm text-[#e9edef] placeholder:text-[#8696a0] focus:border-blue-500/50 focus:outline-none"
              />
            </div>

            <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {filterPills.map((pill) => (
                <button
                  key={pill.label}
                  type="button"
                  className={`h-8 shrink-0 rounded-full border px-3 text-sm font-semibold transition ${
                    pill.active
                      ? 'border-blue-500/30 bg-gradient-to-r from-blue-600/35 to-red-600/30 text-white'
                      : 'border-white/10 bg-transparent text-[#aebac1] hover:border-white/20 hover:text-white'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
              <button 
                onClick={() => setShowNewChatModal(true)}
                title="New Chat"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-[#aebac1] transition hover:border-blue-500/40 hover:text-white cursor-pointer"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <button type="button" className="mx-4 mb-2 flex h-12 items-center gap-8 rounded-lg px-5 text-left text-[#aebac1] transition hover:bg-[#202c2f] cursor-pointer">
            <LockKeyhole className="h-5 w-5" />
            <span className="text-base font-medium">Locked chats</span>
          </button>

          <button
            type="button"
            onClick={openProfileSettings}
            className="mx-3 mb-2 flex items-center gap-3 rounded-lg bg-[#2a2f2d] p-3 text-left transition hover:bg-[#333937] cursor-pointer"
          >
            <img
              src={profile?.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=fallback'}
              alt="Edit profile"
              className="h-12 w-12 rounded-full object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-base font-semibold text-white">
                  {profile?.display_name || 'Me'} (You)
                </p>
                <span className="text-xs text-[#aebac1]">10:10 PM</span>
              </div>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-sm text-[#aebac1]">
                <CheckCheck className="h-4 w-4 shrink-0 text-blue-400" />
                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{profile?.status || 'Edit your profile'}</span>
              </p>
            </div>
            <Pin className="h-4 w-4 shrink-0 text-[#aebac1]" />
          </button>

          {/* Chat List Items */}
          <div className="flex-1 overflow-y-auto px-2 pb-24 md:pb-3">
            {filteredChats.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center justify-center space-y-3">
                <MessageSquare className="w-10 h-10 text-gray-600" />
                <p className="text-gray-500 text-sm">No active chats found.</p>
                <button
                  onClick={() => setShowNewChatModal(true)}
                  className="px-4 py-2 bg-brand-gradient rounded-full text-sm font-semibold text-white cursor-pointer"
                >
                  Start New Chat
                </button>
              </div>
            ) : (
              filteredChats.map((c) => {
                const isActive = activeChat?.id === c.id;
                // Grab matching profile for avatar
                const targetProfile = c.participants?.[0];
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      setActiveChat(c);
                      setMobileView('chat');
                    }}
                    className={`group flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-3 transition duration-200 ${
                      isActive 
                        ? 'bg-[#2a2f2d]' 
                        : 'hover:bg-[#202c2f]'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <img 
                        src={targetProfile?.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + c.id} 
                        alt={c.name}
                        className="h-12 w-12 rounded-full bg-slate-800 object-cover" 
                      />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="truncate text-base font-semibold leading-6 text-[#e9edef]">
                          {c.name}
                        </h4>
                        <span className="mt-1 shrink-0 text-xs text-[#aebac1]">
                          {formatChatTime(c.updated_at || c.created_at)}
                        </span>
                      </div>
                      
                      <div className="mt-0.5 flex items-center justify-between gap-3">
                        <p className="flex min-w-0 items-center gap-1.5 truncate text-sm text-[#aebac1]">
                          <CheckCheck className="h-4 w-4 shrink-0 text-gray-500" />
                          <span className="truncate">
                            {targetProfile?.status || 'You pinned a message'}
                          </span>
                        </p>
                        
                        {isActive && (
                          <Pin className="h-4 w-4 shrink-0 text-gray-500" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <button
            onClick={() => setShowNewChatModal(true)}
            title="New Chat"
            className="absolute bottom-24 right-5 z-20 flex h-[66px] w-[66px] items-center justify-center rounded-3xl bg-brand-gradient text-white shadow-2xl shadow-red-950/40 transition hover:scale-105 md:hidden cursor-pointer"
          >
            <BadgePlus className="h-8 w-8" />
          </button>

          <div className="absolute inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-white/5 bg-[#05090b]/95 px-2 py-3 backdrop-blur md:hidden">
            {bottomNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  className={`relative flex flex-col items-center gap-1 text-xs font-bold ${
                    item.active ? 'text-white' : 'text-gray-400'
                  }`}
                >
                  <span className={`relative rounded-full px-5 py-1.5 ${item.active ? 'bg-gradient-to-r from-blue-600/30 to-red-600/30' : ''}`}>
                    <Icon className="h-6 w-6" />
                    {item.badge && (
                      <span className="absolute -right-0.5 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-gradient-to-r from-blue-600 to-red-600 px-1 text-[10px] text-white">
                        {item.badge}
                      </span>
                    )}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ========================================================= */}
        {/* RIGHT PANEL (CHAT MESSAGE VIEWER)                         */}
        {/* ========================================================= */}
        <div 
          className={`flex-1 flex flex-col h-full bg-[#0b141a] relative transition-all duration-300 ${
            mobileView === 'list' ? 'hidden md:flex' : 'flex'
          }`}
        >
          {activeChat ? (
            <>
              {/* Chat View Header */}
              <div className="z-10 flex h-[66px] items-center justify-between border-b border-black/40 bg-[#1f2725] px-4">
                <div className="flex min-w-0 items-center gap-3">
                  <button 
                    onClick={() => setMobileView('list')}
                    className="rounded-full p-2 text-[#aebac1] transition hover:bg-[#2a302e] hover:text-white md:hidden cursor-pointer"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <img 
                    src={activeChat.participants?.[0]?.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + activeChat.id} 
                    alt={activeChat.name}
                    className="h-10 w-10 rounded-full bg-slate-800 object-cover" 
                  />
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-white">
                      {activeChat.name}
                    </h3>
                    <p className="truncate text-xs text-[#aebac1]">
                      {activeChat.participants?.[0]?.status || 'Message yourself'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-[#aebac1]">
                  <button
                    type="button"
                    title="Search"
                    className="rounded-full p-2 transition hover:bg-[#2a302e] hover:text-white cursor-pointer"
                  >
                    <Search className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    title="More"
                    className="rounded-full p-2 transition hover:bg-[#2a302e] hover:text-white cursor-pointer"
                  >
                    <MoreVertical className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex h-12 items-center gap-6 border-b border-black/30 bg-[#1f2725]/90 px-8 text-sm text-[#c8d0d4]">
                <Pin className="h-4 w-4 shrink-0 text-[#aebac1]" />
                <span className="truncate">
                  {activeChat.participants?.[0]?.status || 'Private conversation'}
                </span>
              </div>

              {/* Chat messages viewport */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 chat-bg-pattern">
                <div className="flex justify-center">
                  <div className="rounded-lg bg-[#202c2f]/90 px-3 py-1.5 text-xs text-[#c8d0d4] shadow">
                    You pinned a message
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {messages.map((m) => {
                    const isOutgoing = m.sender_id === user.id;
                    const messageTime = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    return (
                      <motion.div
                        key={m.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`group/message relative max-w-[78%] rounded-2xl px-4 py-2.5 shadow-md ${
                            isOutgoing 
                              ? 'bubble-outgoing text-white' 
                              : 'bubble-incoming text-gray-200'
                          }`}
                        >
                          {m.message_type === 'image' && m.media_url && (
                            <a href={m.media_url} target="_blank" rel="noreferrer" className="mb-2 block overflow-hidden rounded-xl">
                              <img src={m.media_url} alt={m.content || 'Shared image'} className="max-h-80 w-full object-contain" loading="lazy" />
                            </a>
                          )}
                          {m.message_type === 'voice' && m.media_url && (
                            <div className="mb-1 flex min-w-[220px] items-center gap-2">
                              <Mic className="h-5 w-5 shrink-0 text-blue-300" />
                              <audio controls preload="metadata" src={m.media_url} className="h-9 min-w-0 flex-1" />
                              {m.duration_seconds && <span className="text-[10px] text-white/60">{m.duration_seconds}s</span>}
                            </div>
                          )}
                          {m.content && m.message_type !== 'voice' && (
                            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed select-text">{m.content}</p>
                          )}
                          {m.message_type !== 'text' && !m.media_url && (
                            <p className="text-xs text-amber-200">Media link expired. Refresh the conversation.</p>
                          )}
                          <div className="flex items-center justify-end space-x-1 mt-1">
                            <span className="text-[9px] text-white/50 block select-none">
                              {messageTime}
                            </span>
                            {isOutgoing && (
                              <CheckCheck className={`h-3.5 w-3.5 shrink-0 ${m.is_read ? 'text-blue-300' : 'text-white/40'}`} />
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setReactingTo((current) => current === m.id ? null : m.id)}
                            title="React to message"
                            className={`absolute -top-3 ${isOutgoing ? '-left-8' : '-right-8'} rounded-full bg-[#26302d] p-1.5 text-[#aebac1] opacity-0 shadow transition hover:text-white group-hover/message:opacity-100`}
                          >
                            <Smile className="h-4 w-4" />
                          </button>
                          {reactingTo === m.id && (
                            <div className={`absolute -top-11 z-30 flex gap-1 rounded-full border border-white/10 bg-[#202624] p-1.5 shadow-xl ${isOutgoing ? 'right-0' : 'left-0'}`}>
                              {REACTION_EMOJIS.map((emoji) => (
                                <button key={emoji} type="button" onClick={() => void toggleReaction(m, emoji)} className="rounded-full p-1 text-lg transition hover:scale-125 hover:bg-white/10">{emoji}</button>
                              ))}
                            </div>
                          )}
                          {!!m.reactions?.length && (
                            <div className={`absolute -bottom-4 flex gap-1 ${isOutgoing ? 'right-2' : 'left-2'}`}>
                              {Array.from(new Set(m.reactions.map((reaction) => reaction.emoji))).map((emoji) => {
                                const count = m.reactions?.filter((reaction) => reaction.emoji === emoji).length || 0;
                                const mine = m.reactions?.some((reaction) => reaction.emoji === emoji && reaction.user_id === user.id);
                                return (
                                  <button key={emoji} type="button" onClick={() => void toggleReaction(m, emoji)} className={`rounded-full border px-1.5 py-0.5 text-xs shadow ${mine ? 'border-blue-400/60 bg-blue-500/20' : 'border-white/10 bg-[#202624]'}`}>
                                    {emoji}{count > 1 ? ` ${count}` : ''}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                
                <div ref={messagesEndRef} />
              </div>

              {actionError && (
                <div role="alert" className="flex items-center justify-between border-t border-red-500/20 bg-red-950/50 px-4 py-2 text-xs text-red-200">
                  <span>{actionError}</span>
                  <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss error"><X className="h-4 w-4" /></button>
                </div>
              )}
              {/* Chat composer */}
              <form onSubmit={handleSendMessage} className="relative flex min-h-[62px] items-center gap-2 bg-[#1f2725] px-3 py-2">
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleFileSelected} className="hidden" />
                <button
                  type="button"
                  title="Send an image"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || isRecording}
                  className="rounded-full p-2.5 text-[#aebac1] transition hover:bg-[#2a302e] hover:text-white cursor-pointer"
                >
                  {isUploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Paperclip className="h-6 w-6" />}
                </button>
                <button
                  type="button"
                  title="Insert emoji"
                  onClick={() => setShowEmojiPicker((visible) => !visible)}
                  disabled={isRecording}
                  className="rounded-full p-2.5 text-[#aebac1] transition hover:bg-[#2a302e] hover:text-white cursor-pointer"
                >
                  <Smile className="h-6 w-6" />
                </button>
                {showEmojiPicker && (
                  <div className="absolute bottom-[58px] left-12 z-30 grid grid-cols-4 gap-1 rounded-2xl border border-white/10 bg-[#202624] p-2 shadow-2xl">
                    {EMOJIS.map((emoji) => (
                      <button key={emoji} type="button" onClick={() => { setInputText((text) => text + emoji); setShowEmojiPicker(false); }} className="rounded-lg p-2 text-xl hover:bg-white/10">{emoji}</button>
                    ))}
                  </div>
                )}
                
                <input 
                  type="text"
                  placeholder={isRecording ? 'Recording voice message…' : 'Type a message'}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={isRecording || isUploading}
                  maxLength={5000}
                  className="min-w-0 flex-1 rounded-xl border border-transparent bg-[#2a302e] px-4 py-3 text-sm text-white placeholder:text-[#aebac1] focus:border-blue-500/50 focus:outline-none"
                />

                <button
                  type={inputText.trim() ? 'submit' : 'button'}
                  onClick={inputText.trim() ? undefined : (isRecording ? stopRecording : () => void startRecording())}
                  disabled={isUploading}
                  title={inputText.trim() ? 'Send message' : isRecording ? 'Stop and send recording' : 'Record voice message'}
                  className={`rounded-full p-2.5 transition cursor-pointer ${
                    inputText.trim()
                      ? 'bg-brand-gradient text-white shadow-md shadow-blue-500/10 hover:opacity-95'
                      : isRecording ? 'bg-red-500 text-white animate-pulse' : 'text-[#aebac1] hover:bg-[#2a302e] hover:text-white'
                  }`}
                >
                  {inputText.trim() ? <Send className="h-5 w-5" /> : isRecording ? <StopCircle className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                </button>
              </form>
            </>
          ) : (
            // No Active Chat Placeholder View
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center chat-bg-pattern relative">
              <div className="max-w-md space-y-6">
                <div className="w-20 h-20 bg-brand-gradient rounded-3xl flex items-center justify-center shadow-2xl mx-auto border border-white/10 relative">
                  <ShieldCheck className="w-11 h-11 text-white" />
                  <div className="absolute -inset-0.5 bg-brand-gradient rounded-3xl blur opacity-35" />
                </div>
                
                <div className="space-y-2">
                  <h2 className="text-3xl font-extrabold tracking-wider bg-gradient-to-r from-blue-400 to-red-400 bg-clip-text text-transparent">
                    3SChat
                  </h2>
                  <p className="text-gray-400 text-sm leading-relaxed max-w-xs mx-auto">
                    Select a secure user conversation or click the new message button to begin private communications.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto pt-4 border-t border-white/5">
                  <div className="p-3 rounded-2xl glass-card text-left space-y-1">
                    <ShieldCheck className="w-5 h-5 text-blue-400" />
                    <h4 className="text-xs font-bold text-white">Database protected</h4>
                    <p className="text-[10px] text-gray-500 leading-normal">
                      RLS checks verify user participant headers for every message request.
                    </p>
                  </div>
                  <div className="p-3 rounded-2xl glass-card text-left space-y-1">
                    <Sparkles className="w-5 h-5 text-red-400" />
                    <h4 className="text-xs font-bold text-white">Single session lock</h4>
                    <p className="text-[10px] text-gray-500 leading-normal">
                      One user account is restricted to exactly one active device socket at a time.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ========================================================= */}
        {/* NEW CHAT / USER SELECTION MODAL                           */}
        {/* ========================================================= */}
        <AnimatePresence>
          {showNewChatModal && (
            <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-md glass-container rounded-3xl p-6 shadow-2xl relative"
              >
                <div className="absolute top-0 left-0 right-0 h-1 bg-brand-gradient rounded-t-3xl" />
                
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                    <MessageSquarePlus className="w-5 h-5 text-blue-400" />
                    <span>Start Secure Conversation</span>
                  </h3>
                  <button 
                    onClick={() => {
                      setShowNewChatModal(false);
                      setNewChatSearch('');
                    }}
                    className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="relative mb-4">
                  <Search className="absolute inset-y-0 left-3 my-auto w-4 h-4 text-gray-500" />
                  <input 
                    type="text"
                    placeholder="Search users by name or number..."
                    value={newChatSearch}
                    onChange={(e) => setNewChatSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 text-xs rounded-xl glass-input"
                  />
                </div>

                <div className="max-h-[300px] overflow-y-auto divide-y divide-white/5 pr-1">
                  {filteredProfiles.length === 0 ? (
                    <div className="p-8 text-center">
                      <p className="text-gray-500 text-xs">No active users found.</p>
                    </div>
                  ) : (
                    filteredProfiles.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => handleStartChat(p)}
                        className="py-3 flex items-center justify-between cursor-pointer group hover:bg-white/5 px-2 rounded-xl transition duration-150"
                      >
                        <div className="flex items-center space-x-3">
                          <img 
                            src={p.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p.id)}`}
                            alt={p.display_name} 
                            className="w-9 h-9 rounded-xl bg-slate-800 object-cover"
                          />
                          <div>
                            <h4 className="font-bold text-sm text-white group-hover:text-blue-400 transition truncate max-w-[180px]">
                              {p.display_name}
                            </h4>
                            <p className="text-[10px] text-gray-500 font-mono">
                              {p.phone_number}
                            </p>
                          </div>
                        </div>

                        <span className="text-[10px] text-gray-400 bg-white/5 group-hover:bg-blue-500 group-hover:text-white px-2.5 py-1 rounded-lg transition font-semibold">
                          Secure Link
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ========================================================= */}
        {/* PROFILE / SETTINGS EDIT MODAL                             */}
        {/* ========================================================= */}
        <AnimatePresence>
          {showSettings && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#111614] p-0 shadow-2xl"
              >
                <div className="h-1 bg-brand-gradient" />

                <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                  <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                    <Settings className="h-5 w-5 text-blue-400" />
                    <span>Edit profile</span>
                  </h3>
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="rounded-full p-2 text-[#aebac1] hover:bg-[#2a302e] hover:text-white cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <form onSubmit={handleUpdateProfile} className="space-y-4 p-5">
                  <div className="flex flex-col items-center">
                    <img 
                      src={editAvatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=fallback'} 
                      alt="Avatar Preview" 
                      className="mb-3 h-28 w-28 rounded-full border border-white/20 object-cover shadow-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setEditAvatar(`https://api.dicebear.com/7.x/bottts/svg?seed=${Math.random().toString(36).substring(7)}`)}
                      className="flex items-center gap-1 text-xs text-blue-400 hover:underline cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Randomise Avatar</span>
                    </button>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase text-[#aebac1]">
                      Profile Photo URL
                    </label>
                    <input 
                      type="url"
                      value={editAvatar}
                      onChange={(e) => setEditAvatar(e.target.value)}
                      placeholder="https://..."
                      className="w-full rounded-xl border border-white/10 bg-[#202c2f] px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/70"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase text-[#aebac1]">
                      Display Name
                    </label>
                    <input 
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#202c2f] px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/70"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase text-[#aebac1]">
                      Status Message
                    </label>
                    <input 
                      type="text"
                      required
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#202c2f] px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/70"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowSettings(false)}
                      className="w-1/3 rounded-xl border border-white/10 py-3 text-sm text-[#aebac1] transition hover:bg-[#202c2f] hover:text-white cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isUpdatingProfile}
                      className="flex w-2/3 items-center justify-center gap-2 rounded-xl bg-brand-gradient py-3 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60 cursor-pointer"
                    >
                      {isUpdatingProfile ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span>Save profile</span>
                      )}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
