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
  Paperclip,
  Star,
  Unlock,
  Ban
} from 'lucide-react';
import { Video } from 'lucide-react';
import { CallOverlay } from '../../components/chat/CallOverlay';
import { UtilityPanel } from '../../components/chat/UtilityPanel';
import { PushNotificationButton } from '../../components/chat/PushNotificationButton';
import { MessageBubble } from '../../components/chat/MessageBubble';
import { useWebRtcCall } from '../../hooks/useWebRtcCall';
import { pendingMessages, queueMessage, removePendingMessage } from '../../lib/offlineQueue';
import { decryptMessage, encryptMessage } from '../../lib/e2ee';
import { filterChats, unreadTotal, type ChatFilterValue } from '../../lib/chatUtils';
import { compressImageForUpload, IMAGE_MAX_BYTES, validateUploadSize, VOICE_MAX_BYTES } from '../../lib/media';
import { 
  supabase, 
  Profile, 
  Chat, 
  ChatSummary,
  Message,
  MessageReaction,
  MessageReceipt,
  MessageType,
  databaseErrorMessage,
} from '../../lib/supabaseClient';

const EMOJIS = ['😀', '😂', '😍', '👍', '❤️', '🔥', '🎉', '😮'];
const MESSAGE_PAGE_SIZE = 30;
const TYPING_BROADCAST_INTERVAL_MS = 2500;
const MESSAGE_SELECT = 'id, chat_id, sender_id, content, message_type, media_path, media_mime_type, media_size, duration_seconds, is_read, created_at, updated_at, edited_at, deleted_at, encrypted_content, encryption_iv, encryption_version, message_reactions(message_id, user_id, emoji, created_at), message_receipts(message_id, user_id, delivered_at, read_at)';

export default function ChatPage() {
  const { user, profile, logout, updateProfile, changeEmail, changePhone, loading } = useAuth();
  const router = useRouter();
  const callManager = useWebRtcCall(user?.id);

  // Navigation / Panel states
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  
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
  const [chatFilter, setChatFilter] = useState<ChatFilterValue>('all');
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [messageActionId, setMessageActionId] = useState<string | null>(null);
  const [unlockedChatIds, setUnlockedChatIds] = useState<Set<string>>(() => new Set());
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupEditChat, setGroupEditChat] = useState<Chat | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<Set<string>>(() => new Set());
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(() => new Set());
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(() => new Set());
  const [utilityPanel, setUtilityPanel] = useState<'updates' | 'communities' | 'calls' | null>(null);
  const [chatSecrets, setChatSecrets] = useState<Map<string, string>>(() => new Map());

  // Input states
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newChatSearch, setNewChatSearch] = useState('');
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedRef = useRef(0);
  const recordingLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingBroadcastRef = useRef(0);
  const typingActiveRef = useRef(false);
  const loadedMessageIdsRef = useRef<Set<string>>(new Set());
  const previousMessageScrollTopRef = useRef(0);
  const lastSeenTouchRef = useRef(0);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const activeChatId = activeChat?.id;
  const activeChatIdRef = useRef<string | undefined>(activeChatId);

  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);

  const scheduleChatListRefresh = () => {
    if (chatRefreshTimerRef.current) clearTimeout(chatRefreshTimerRef.current);
    chatRefreshTimerRef.current = setTimeout(() => void fetchChatsAndProfiles(), 500);
  };

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

  const flushOfflineQueue = async () => {
    if (!user || !navigator.onLine) return;
    const queued = await pendingMessages(user.id);
    for (const entry of queued) {
      const { error } = await supabase.from('messages').insert({ chat_id: entry.chatId, sender_id: entry.senderId, content: entry.content, encrypted_content: entry.encryptedContent, encryption_iv: entry.encryptionIv, encryption_version: entry.encryptionVersion, message_type: 'text' });
      if (!error) await removePendingMessage(entry.id);
    }
    if (queued.length) setActionError('Queued messages were sent.');
  };

  const fetchProfiles = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, phone_number, display_name, avatar_url, status, last_seen, role, account_status')
      .neq('id', user.id)
      .eq('account_status', 'active')
      .order('display_name');
    if (error) throw error;
    setProfiles((data || []) as Profile[]);
  };

  // 2. Fetch compact chat-list data. Message bodies are paginated separately.
  const fetchChatsAndProfiles = async () => {
    if (!user) return;
    try {
      const { data: participantsData, error: cpError } = await supabase
        .from('chat_participants')
        .select('chat_id, is_favorite, is_locked, is_archived, member_role')
        .eq('user_id', user.id);
      if (cpError) throw cpError;

      const chatIds = (participantsData || []).map((participant) => participant.chat_id);
      if (chatIds.length) {
        const [{ data: chatsData, error: chatsError }, { data: summaryData, error: summaryError }, { data: blockedData, error: blockedError }] = await Promise.all([
          supabase
            .from('chats')
            .select('id, name, is_group, created_at, updated_at, encryption_enabled, encryption_salt, chat_participants(user_id, profiles(id, phone_number, display_name, avatar_url, status, last_seen, role, account_status))')
            .in('id', chatIds)
            .order('updated_at', { ascending: false }),
          supabase.rpc('get_chat_summaries'),
          supabase
            .from('blocked_users')
            .select('blocked_id')
            .eq('blocker_id', user.id),
        ]);
        if (chatsError) throw chatsError;
        if (summaryError) throw summaryError;
        if (blockedError) throw blockedError;

        const preferences = new Map((participantsData || []).map((participant) => [participant.chat_id, participant]));
        const summaries = new Map(((summaryData || []) as ChatSummary[]).map((summary) => [summary.chat_id, summary]));
        const blockedIds = new Set((blockedData || []).map((block) => block.blocked_id));

        const formattedChats = (chatsData || []).map((chat) => {
          const rows = chat.chat_participants as unknown as Array<{ user_id: string; profiles: Profile | Profile[] }>;
          const isSelf = rows.length === 1 && rows[0]?.user_id === user.id;
          const listParticipants = rows
            .filter((participant) => participant.user_id !== user.id)
            .flatMap((participant) => Array.isArray(participant.profiles) ? participant.profiles : [participant.profiles])
            .filter(Boolean);
          if (isSelf && profile) listParticipants.push(profile);
          const preference = preferences.get(chat.id);
          const summary = summaries.get(chat.id);
          const preview = summary?.last_message_deleted_at
            ? 'Message deleted'
            : summary?.last_message_type === 'image'
              ? '📷 Image'
              : summary?.last_message_type === 'voice'
                ? '🎙 Voice message'
                : summary?.last_message_encrypted ? '🔒 Encrypted message' : summary?.last_message_content;
          return {
            id: chat.id,
            name: isSelf ? `${profile?.display_name || 'Me'} (You)` : chat.is_group ? (chat.name || 'Group') : (listParticipants[0]?.display_name || 'Direct chat'),
            is_group: chat.is_group,
            created_at: chat.created_at,
            updated_at: chat.updated_at,
            participants: listParticipants,
            is_self: isSelf,
            is_favorite: preference?.is_favorite || false,
            is_locked: preference?.is_locked || false,
            is_archived: preference?.is_archived || false,
            member_role: preference?.member_role || 'member',
            encryption_enabled: chat.encryption_enabled || false,
            encryption_salt: chat.encryption_salt,
            unread_count: Number(summary?.unread_count || 0),
            last_message: preview || null,
            is_blocked: !isSelf && !!listParticipants[0] && blockedIds.has(listParticipants[0].id),
          } as Chat;
        });
        setChats(formattedChats);
        setActiveChat((current) => current ? (formattedChats.find((chat) => chat.id === current.id) || current) : current);
      } else {
        setChats([]);
      }

    } catch (err) {
      const message = databaseErrorMessage(err, 'Unable to load conversations.');
      console.error('Error fetching chats/profiles:', message, err);
      setActionError(message);
    } finally {
      setChatsLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    const timeout = setTimeout(() => void Promise.all([fetchChatsAndProfiles(), fetchProfiles()]).catch((error) => {
      setActionError(databaseErrorMessage(error, 'Unable to load contacts.'));
    }), 0);
    return () => clearTimeout(timeout);
    // Fetchers intentionally use the latest authenticated user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const flush = () => void flushOfflineQueue();
    window.addEventListener('online', flush);
    const timeout = setTimeout(flush, 0);
    return () => { clearTimeout(timeout); window.removeEventListener('online', flush); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const touchLastSeen = () => {
      const now = Date.now();
      if (now - lastSeenTouchRef.current < 60_000) return;
      lastSeenTouchRef.current = now;
      void supabase.from('profiles').update({ last_seen: new Date(now).toISOString() }).eq('id', user.id);
    };
    const onVisibilityChange = () => touchLastSeen();
    touchLastSeen();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [user]);

  const hydrateMessages = async (rows: Array<Record<string, unknown>>, chatId: string, pinnedIds: Set<string>) => {
    const mediaPaths = Array.from(new Set(rows
      .map((row) => row.media_path)
      .filter((path): path is string => typeof path === 'string' && !!path)));
    const signedUrls = new Map<string, string>();
    if (mediaPaths.length) {
      const { data: signedData } = await supabase.storage.from('chat-media').createSignedUrls(mediaPaths, 3600);
      for (const signed of signedData || []) {
        if (signed.path && signed.signedUrl) signedUrls.set(signed.path, signed.signedUrl);
      }
    }

    return Promise.all(rows.map(async (row) => {
      const reactions = (row.message_reactions || []) as MessageReaction[];
      const receipts = (row.message_receipts || []) as MessageReceipt[];
      const message = {
        ...row,
        reactions,
        receipts,
        is_pinned: pinnedIds.has(row.id as string),
      } as unknown as Message;
      if (message.media_path && !message.deleted_at) message.media_url = signedUrls.get(message.media_path);
      if (message.encrypted_content && message.encryption_iv) {
        const secret = chatSecrets.get(chatId);
        const chat = chats.find((entry) => entry.id === chatId);
        if (secret && chat?.encryption_salt) {
          try { message.content = await decryptMessage(message.encrypted_content, message.encryption_iv, secret, chat.encryption_salt); }
          catch { message.content = null; message.decryption_failed = true; }
        } else {
          message.content = null;
          message.decryption_failed = true;
        }
      }
      return message;
    }));
  };

  // 3. Load only the newest page, then prepend older pages on demand.
  const fetchMessages = async (chatId: string, mode: 'initial' | 'refresh' | 'older' = 'refresh') => {
    if (mode === 'older' && (olderMessagesLoading || !hasOlderMessages)) return;
    const viewport = messagesViewportRef.current;
    const previousScrollHeight = viewport?.scrollHeight || 0;
    if (mode === 'initial') setMessagesLoading(true);
    if (mode === 'older') setOlderMessagesLoading(true);
    try {
      if (mode !== 'older') {
        const { error: readError } = await supabase.rpc('mark_chat_read', { target_chat_id: chatId });
        if (readError) throw readError;
      }

      let messageQuery = supabase
        .from('messages')
        .select(MESSAGE_SELECT)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);
      if (mode === 'older' && messages[0]?.created_at) {
        const cursor = messages[0];
        messageQuery = messageQuery.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
      }

      const [{ data, error }, { data: pinData, error: pinError }] = await Promise.all([
        messageQuery,
        supabase
          .from('message_pins')
          .select('message_id, pinned_at')
          .eq('chat_id', chatId)
          .order('pinned_at', { ascending: false }),
      ]);
      if (error) throw error;
      if (pinError) throw pinError;
      if (activeChatIdRef.current !== chatId) return;
      const pinnedIds = new Set((pinData || []).map((pin) => pin.message_id));
      const hydrated = (await hydrateMessages((data || []) as Array<Record<string, unknown>>, chatId, pinnedIds)).reverse();

      setMessages((current) => {
        const combined = mode === 'initial' ? hydrated : mode === 'older' ? [...hydrated, ...current] : [...current, ...hydrated];
        const unique = Array.from(new Map(combined.map((message) => [message.id, message])).values())
          .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
        loadedMessageIdsRef.current = new Set(unique.map((message) => message.id));
        return unique;
      });
      if (mode !== 'refresh') setHasOlderMessages((data || []).length === MESSAGE_PAGE_SIZE);
      if (mode === 'initial') scrollToBottom();
      if (mode === 'older' && viewport) {
        requestAnimationFrame(() => { viewport.scrollTop = viewport.scrollHeight - previousScrollHeight; });
      }
    } catch (err) {
      const message = databaseErrorMessage(err, 'Unable to load messages.');
      console.error('Error fetching messages:', message, err);
      setActionError(message);
    } finally {
      if (mode === 'initial') setMessagesLoading(false);
      if (mode === 'older') setOlderMessagesLoading(false);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      setMessages([]);
      loadedMessageIdsRef.current = new Set();
      previousMessageScrollTopRef.current = 0;
      setHasOlderMessages(false);
      if (activeChatId) void fetchMessages(activeChatId, 'initial');
    }, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);

  // 4. Realtime subscriber for new messages
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('chat-presence', { config: { presence: { key: user.id }, broadcast: { self: false } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        const changed = (Object.keys(payload.new || {}).length ? payload.new : payload.old) as Partial<Message>;
        if (activeChatId && (changed.chat_id === activeChatId || (!!changed.id && loadedMessageIdsRef.current.has(changed.id)))) {
          void fetchMessages(activeChatId, 'refresh');
        }
        scheduleChatListRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => {
        const changed = (Object.keys(payload.new || {}).length ? payload.new : payload.old) as Partial<MessageReaction>;
        if (!changed.message_id || !changed.user_id || !changed.emoji || !loadedMessageIdsRef.current.has(changed.message_id)) return;
        setMessages((current) => current.map((message) => {
          if (message.id !== changed.message_id) return message;
          const withoutChanged = (message.reactions || []).filter((reaction) => !(reaction.user_id === changed.user_id && reaction.emoji === changed.emoji));
          return { ...message, reactions: payload.eventType === 'DELETE' ? withoutChanged : [...withoutChanged, changed as MessageReaction] };
        }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_pins' }, (payload) => {
        const changed = (Object.keys(payload.new || {}).length ? payload.new : payload.old) as { chat_id?: string; message_id?: string };
        if (!activeChatId || changed.chat_id !== activeChatId || !changed.message_id) return;
        setMessages((current) => current.map((message) => message.id === changed.message_id ? { ...message, is_pinned: payload.eventType !== 'DELETE' } : message));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_participants', filter: `user_id=eq.${user.id}` }, () => {
        scheduleChatListRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_receipts' }, (payload) => {
        const changed = (Object.keys(payload.new || {}).length ? payload.new : payload.old) as Partial<MessageReceipt>;
        if (!changed.message_id || !changed.user_id || !loadedMessageIdsRef.current.has(changed.message_id)) return;
        setMessages((current) => current.map((message) => {
          if (message.id !== changed.message_id) return message;
          const withoutChanged = (message.receipts || []).filter((receipt) => receipt.user_id !== changed.user_id);
          return { ...message, receipts: payload.eventType === 'DELETE' ? withoutChanged : [...withoutChanged, changed as MessageReceipt] };
        }));
      })
      .on('presence', { event: 'sync' }, () => {
        const ids = new Set<string>();
        for (const entries of Object.values(channel.presenceState())) {
          for (const entry of entries as Array<{ user_id?: string }>) if (entry.user_id) ids.add(entry.user_id);
        }
        setOnlineUserIds(ids);
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const event = payload as { user_id?: string; chat_id?: string; is_typing?: boolean };
        if (!event.user_id || event.chat_id !== activeChatId) return;
        setTypingUserIds((current) => {
          const next = new Set(current);
          if (event.is_typing) next.add(event.user_id!); else next.delete(event.user_id!);
          return next;
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void channel.track({ user_id: user.id, online_at: new Date().toISOString() });
      });
    realtimeChannelRef.current = channel;

    return () => {
      realtimeChannelRef.current = null;
      if (chatRefreshTimerRef.current) clearTimeout(chatRefreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
    // Re-subscribe only when the authenticated user or selected chat changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeChatId]);

  const broadcastTyping = (isTyping: boolean) => {
    if (!activeChat || !user) return;
    typingActiveRef.current = isTyping;
    lastTypingBroadcastRef.current = Date.now();
    void realtimeChannelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: user.id, chat_id: activeChat.id, is_typing: isTyping } });
  };

  const notifyChatParticipants = async (chatId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch('/api/push/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ chatId, title: profile?.display_name || '3SChat', body: 'New message' }) }).catch(() => undefined);
  };

  const handleMessageInput = (value: string) => {
    setInputText(value);
    const hasText = !!value.trim();
    const now = Date.now();
    if (hasText && (!typingActiveRef.current || now - lastTypingBroadcastRef.current >= TYPING_BROADCAST_INTERVAL_MS)) {
      broadcastTyping(true);
    } else if (!hasText && typingActiveRef.current) {
      broadcastTyping(false);
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (hasText) typingTimerRef.current = setTimeout(() => broadcastTyping(false), 3000);
  };

  // 5. Send message action
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChat || !user || activeChat.is_blocked) return;

    const textToSend = inputText;
    setInputText('');
    broadcastTyping(false);

    let encrypted: Awaited<ReturnType<typeof encryptMessage>> | null = null;
    if (activeChat.encryption_enabled) {
      const secret = chatSecrets.get(activeChat.id);
      if (!secret || !activeChat.encryption_salt) {
        setInputText(textToSend);
        setActionError('Enter the shared encryption secret before sending.');
        return;
      }
      encrypted = await encryptMessage(textToSend.trim(), secret, activeChat.encryption_salt);
    }

    if (!navigator.onLine) {
      const queued = { id: crypto.randomUUID(), chatId: activeChat.id, senderId: user.id, content: encrypted ? null : textToSend.trim(), encryptedContent: encrypted?.encrypted_content, encryptionIv: encrypted?.encryption_iv, encryptionVersion: encrypted?.encryption_version, createdAt: new Date().toISOString() };
      await queueMessage(queued);
      setMessages((current) => [...current, { id: queued.id, chat_id: queued.chatId, sender_id: queued.senderId, content: textToSend.trim(), message_type: 'text', media_path: null, media_mime_type: null, media_size: null, duration_seconds: null, created_at: queued.createdAt, updated_at: queued.createdAt, is_read: false, pending: true }]);
      setActionError('Offline: message queued and will send when the connection returns.');
      return;
    }

    try {
      const { error } = await supabase.from('messages').insert({
        chat_id: activeChat.id,
        sender_id: user.id,
        content: encrypted ? null : textToSend.trim(),
        ...encrypted,
        message_type: 'text',
        is_read: !!activeChat.is_self,
      });
      if (error) throw error;
      void notifyChatParticipants(activeChat.id);
      await fetchMessages(activeChat.id, 'refresh');
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

  const openGroupEditor = (chat?: Chat) => {
    setGroupEditChat(chat || null);
    setGroupName(chat?.name || '');
    setGroupMemberIds(new Set());
    setShowGroupModal(true);
    setShowChatMenu(false);
  };

  const saveGroup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupName.trim()) return;
    setIsUploading(true);
    const memberIds = Array.from(groupMemberIds);
    const result = groupEditChat
      ? await supabase.rpc('update_group', { target_chat_id: groupEditChat.id, group_name: groupName, add_member_ids: memberIds })
      : await supabase.rpc('create_group', { group_name: groupName, member_ids: memberIds });
    setIsUploading(false);
    if (result.error) {
      setActionError(result.error.message);
      return;
    }
    setShowGroupModal(false);
    if (!groupEditChat && result.data) {
      setActiveChat({ id: result.data, name: groupName.trim(), is_group: true, created_at: new Date().toISOString(), participants: profiles.filter((entry) => groupMemberIds.has(entry.id)), member_role: 'owner' });
      setMobileView('chat');
    }
    await fetchChatsAndProfiles();
  };

  const removeGroupMember = async (member: Profile) => {
    if (!groupEditChat || !window.confirm(`Remove ${member.display_name} from this group?`)) return;
    const { error } = await supabase.rpc('remove_group_member', { target_chat_id: groupEditChat.id, target_user_id: member.id });
    if (error) setActionError(error.message);
    else {
      setGroupEditChat({ ...groupEditChat, participants: groupEditChat.participants?.filter((entry) => entry.id !== member.id) });
      await fetchChatsAndProfiles();
    }
  };

  const uploadMediaMessage = async (file: File, messageType: MessageType, durationSeconds?: number) => {
    if (!activeChat || !user || activeChat.is_blocked) return;
    if (messageType === 'image') validateUploadSize(file, IMAGE_MAX_BYTES, 'Image');
    else if (messageType === 'voice') validateUploadSize(file, VOICE_MAX_BYTES, 'Voice note');
    else throw new Error('Only images and voice notes are enabled in this free-tier build.');

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
        is_read: !!activeChat.is_self,
      });
      if (messageError) {
        await supabase.storage.from('chat-media').remove([path]);
        throw messageError;
      }

      void notifyChatParticipants(activeChat.id);
      await fetchMessages(activeChat.id, 'refresh');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setActionError('Choose a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('The original image must be 10 MB or smaller before optimization.');
      const optimized = await compressImageForUpload(file);
      validateUploadSize(optimized, IMAGE_MAX_BYTES, 'Image');
      await uploadMediaMessage(optimized, 'image');
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
        if (recordingLimitTimerRef.current) clearTimeout(recordingLimitTimerRef.current);
        recordingLimitTimerRef.current = null;
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
      recordingLimitTimerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 5 * 60 * 1000);
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
  };

  const openChat = async (chat: Chat) => {
    if (chat.is_locked && !unlockedChatIds.has(chat.id)) {
      const pin = window.prompt(`Enter the PIN for ${chat.name}`);
      if (pin === null) return;
      const { data: verified, error } = await supabase.rpc('verify_chat_lock_pin', { target_chat_id: chat.id, pin_value: pin });
      if (error || !verified) {
        setActionError(error?.message || 'Incorrect chat PIN.');
        return;
      }
      setUnlockedChatIds((current) => new Set(current).add(chat.id));
    }
    if (chat.encryption_enabled && !chatSecrets.has(chat.id)) {
      const secret = window.prompt(`Enter the shared encryption secret for ${chat.name}`);
      if (!secret) return;
      setChatSecrets((current) => new Map(current).set(chat.id, secret));
    }
    typingActiveRef.current = false;
    lastTypingBroadcastRef.current = 0;
    setTypingUserIds(new Set());
    setActiveChat(chat);
    setShowChatMenu(false);
    setMessageActionId(null);
    setMobileView('chat');
  };

  const openSelfChat = async () => {
    if (!user || !profile) return;
    setActionError(null);
    const { data: chatId, error } = await supabase.rpc('create_self_chat');
    if (error || !chatId) {
      setActionError(error?.message || 'Your personal chat could not be opened.');
      return;
    }
    const existing = chats.find((chat) => chat.id === chatId);
    const selfConversation = existing || {
      id: chatId,
      name: `${profile.display_name} (You)`,
      is_group: false,
      is_self: true,
      created_at: new Date().toISOString(),
      participants: [profile],
      unread_count: 0,
    };
    await openChat(selfConversation);
    await fetchChatsAndProfiles();
  };

  const toggleFavorite = async () => {
    if (!activeChat) return;
    const params = { target_chat_id: activeChat.id, favorite_value: !activeChat.is_favorite, locked_value: null };
    const { error } = await supabase.rpc('set_chat_preferences', params);
    if (error) setActionError(error.message);
    else {
      setShowChatMenu(false);
      await fetchChatsAndProfiles();
    }
  };

  const toggleChatLock = async () => {
    if (!activeChat) return;
    const pin = window.prompt(activeChat.is_locked ? 'Enter the current PIN to unlock this chat' : 'Create a 4–8 digit PIN for this chat');
    if (pin === null) return;
    const rpc = activeChat.is_locked ? 'clear_chat_lock' : 'set_chat_lock_pin';
    const { error } = await supabase.rpc(rpc, { target_chat_id: activeChat.id, pin_value: pin });
    if (error) setActionError(error.message);
    else {
      setUnlockedChatIds((current) => {
        const next = new Set(current);
        if (activeChat.is_locked) next.delete(activeChat.id); else next.add(activeChat.id);
        return next;
      });
      if (activeChat.is_locked && lockedCount === 1) setChatFilter('all');
      setShowChatMenu(false);
      await fetchChatsAndProfiles();
    }
  };

  const toggleArchive = async () => {
    if (!activeChat) return;
    const { error } = await supabase.rpc('set_chat_archived', { target_chat_id: activeChat.id, archived_value: !activeChat.is_archived });
    if (error) setActionError(error.message);
    else {
      setShowChatMenu(false);
      setActiveChat(null);
      await fetchChatsAndProfiles();
    }
  };

  const enableSharedSecretEncryption = async () => {
    if (!activeChat || activeChat.encryption_enabled) return;
    const secret = window.prompt('Create a strong shared secret (at least 12 characters). Share it with participants outside 3SChat. It is never uploaded.');
    if (!secret || secret.length < 12) {
      if (secret !== null) setActionError('The shared secret must contain at least 12 characters.');
      return;
    }
    const { data: salt, error } = await supabase.rpc('enable_chat_encryption', { target_chat_id: activeChat.id });
    if (error || !salt) setActionError(error?.message || 'Encryption could not be enabled.');
    else {
      setChatSecrets((current) => new Map(current).set(activeChat.id, secret));
      setActiveChat({ ...activeChat, encryption_enabled: true, encryption_salt: salt });
      setShowChatMenu(false);
      await fetchChatsAndProfiles();
    }
  };

  const toggleBlockActiveUser = async () => {
    const targetUser = activeChat?.participants?.[0];
    if (!activeChat || activeChat.is_self || !targetUser) return;
    if (!window.confirm(`${activeChat.is_blocked ? 'Unblock' : 'Block'} ${targetUser.display_name}?`)) return;
    const { error } = await supabase.rpc('toggle_block_user', { target_user_id: targetUser.id });
    if (error) setActionError(error.message);
    else {
      setShowChatMenu(false);
      await fetchChatsAndProfiles();
    }
  };

  const runMessageAction = async (message: Message, action: 'pin' | 'edit' | 'delete' | 'report') => {
    setMessageActionId(null);
    if (!activeChat) return;
    try {
      if (action === 'pin') {
        const { error } = await supabase.rpc('toggle_message_pin', { target_message_id: message.id });
        if (error) throw error;
      } else if (action === 'edit') {
        const nextContent = window.prompt('Update your message', message.content || '');
        if (nextContent === null || nextContent.trim() === message.content?.trim()) return;
        const { error } = await supabase.rpc('edit_message', { target_message_id: message.id, new_content: nextContent });
        if (error) throw error;
      } else if (action === 'delete') {
        if (!window.confirm('Delete this message? This cannot be undone.')) return;
        if (message.media_path) {
          const { error: mediaError } = await supabase.storage.from('chat-media').remove([message.media_path]);
          if (mediaError) throw mediaError;
        }
        const { error } = await supabase.rpc('delete_message', { target_message_id: message.id });
        if (error) throw error;
      } else {
        const reason = window.prompt('Why are you reporting this message?');
        if (reason === null) return;
        const { error } = await supabase.rpc('submit_report', { target_message_id: message.id, report_reason: reason });
        if (error) throw error;
        window.alert('Report submitted to the moderation team.');
      }
      if (action !== 'report') await fetchMessages(activeChat.id, 'refresh');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The message could not be updated.');
    }
  };

  const beginLongPress = (messageId: string) => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => setMessageActionId(messageId), 550);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  useEffect(() => () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (recordingLimitTimerRef.current) clearTimeout(recordingLimitTimerRef.current);
    if (chatRefreshTimerRef.current) clearTimeout(chatRefreshTimerRef.current);
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
  const totalUnread = unreadTotal(chats);
  const lockedCount = chats.filter((chat) => chat.is_locked).length;
  const archivedCount = chats.filter((chat) => chat.is_archived).length;
  const selfChat = chats.find((chat) => chat.is_self);
  const latestPinnedMessage = [...messages].reverse().find((message) => message.is_pinned && !message.deleted_at);
  const activeTypingNames = activeChat?.participants?.filter((entry) => typingUserIds.has(entry.id)).map((entry) => entry.display_name) || [];
  const activeChatOnline = activeChat?.participants?.some((entry) => onlineUserIds.has(entry.id)) || false;
  const filteredChats = filterChats(chats, chatFilter, searchQuery);

  const handleMessageScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop;
    const scrollingUp = nextScrollTop < previousMessageScrollTopRef.current;
    previousMessageScrollTopRef.current = nextScrollTop;
    if (scrollingUp && nextScrollTop < 100 && activeChatId && hasOlderMessages && !olderMessagesLoading) {
      void fetchMessages(activeChatId, 'older');
    }
  };

  const filteredProfiles = profiles.filter((p) =>
    p.display_name?.toLowerCase().includes(newChatSearch.toLowerCase()) ||
    p.phone_number?.includes(newChatSearch)
  );

  const filterPills: Array<{ label: string; value: ChatFilterValue }> = [
    { label: 'All', value: 'all' },
    { label: totalUnread ? `Unread ${totalUnread}` : 'Unread', value: 'unread' },
    { label: 'Favorites', value: 'favorites' },
    { label: 'Groups', value: 'groups' },
  ];

  const bottomNavItems = [
    { label: 'Chats', icon: MessageCircle, active: true, badge: totalUnread || undefined },
    { label: 'Updates', icon: CircleDashed, active: false },
    { label: 'Communities', icon: UsersRound, active: false },
    { label: 'Calls', icon: Phone, active: false }
  ];

  const railItems = [
    { label: 'Chats', icon: MessageCircle, active: true, badge: totalUnread || undefined },
    { label: 'Updates', icon: CircleDashed, active: false },
    { label: 'Calls', icon: Phone, active: false },
    { label: 'Communities', icon: UsersRound, active: false }
  ];

  const openProfileSettings = () => {
    setEditName(profile?.display_name || '');
    setEditStatus(profile?.status || '');
    setEditAvatar(profile?.avatar_url || '');
    setEditEmail(user?.email || '');
    setEditPhone(profile?.phone_number || '');
    setShowSettings(true);
  };

  const handleAccountChange = async (kind: 'email' | 'phone') => {
    setIsUpdatingProfile(true);
    const result = kind === 'email' ? await changeEmail(editEmail) : await changePhone(editPhone);
    setIsUpdatingProfile(false);
    if (result.success) window.alert(kind === 'email' ? 'Check both your old and new email inboxes to confirm the change.' : 'Phone number updated.');
    else setActionError(result.error || 'Account update failed.');
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
                  onClick={() => item.label !== 'Chats' && setUtilityPanel(item.label.toLowerCase() as 'updates' | 'communities' | 'calls')}
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
                </button>
              );
            })}
          </div>

          <div className="flex w-full flex-col items-center gap-3">
            <button
              type="button"
              title="Archived"
              onClick={() => setChatFilter((current) => current === 'archived' ? 'all' : 'archived')}
              className={`relative grid h-11 w-11 place-items-center rounded-full transition hover:bg-[#2a302e] hover:text-white ${chatFilter === 'archived' ? 'bg-[#2f3734] text-white' : 'text-[#aebac1]'}`}
            >
              <Archive className="h-5 w-5" />
              {!!archivedCount && <span className="absolute -right-0.5 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-blue-500 px-1 text-[10px] text-white">{archivedCount}</span>}
            </button>
            <button
              type="button"
              title="Settings"
              onClick={openProfileSettings}
              className="grid h-11 w-11 place-items-center rounded-full text-[#aebac1] transition hover:bg-[#2a302e] hover:text-white"
            >
              <Settings className="h-5 w-5" />
            </button>
            {profile?.role !== 'user' && (
              <button type="button" title={profile?.role === 'admin' ? 'Admin dashboard' : 'Moderation dashboard'} onClick={() => router.push('/admin')} className="grid h-11 w-11 place-items-center rounded-full text-blue-300 transition hover:bg-blue-500/10 hover:text-white">
                <ShieldCheck className="h-5 w-5" />
              </button>
            )}
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
                  onClick={() => setChatFilter(pill.value)}
                  className={`h-8 shrink-0 rounded-full border px-3 text-sm font-semibold transition ${
                    chatFilter === pill.value
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

          {lockedCount > 0 && (
            <button type="button" onClick={() => setChatFilter((current) => current === 'locked' ? 'all' : 'locked')} className={`mx-4 mb-2 flex h-12 items-center gap-8 rounded-lg px-5 text-left transition cursor-pointer ${chatFilter === 'locked' ? 'bg-[#202c2f] text-white' : 'text-[#aebac1] hover:bg-[#202c2f]'}`}>
              <LockKeyhole className="h-5 w-5" />
              <span className="flex-1 text-base font-medium">Locked chats</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{lockedCount}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void openSelfChat()}
            className={`mx-3 mb-2 flex items-center gap-3 rounded-lg p-3 text-left transition cursor-pointer ${activeChat?.is_self ? 'bg-[#2a2f2d]' : 'hover:bg-[#202c2f]'}`}
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
                <span className="text-xs text-[#aebac1]">{formatChatTime(selfChat?.updated_at || selfChat?.created_at)}</span>
              </div>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-sm text-[#aebac1]">
                <CheckCheck className="h-4 w-4 shrink-0 text-blue-400" />
                {selfChat?.last_message && <ImageIcon className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{selfChat?.last_message || 'Message yourself'}</span>
              </p>
            </div>
            {selfChat?.is_favorite && <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" />}
          </button>

          {/* Chat List Items */}
          <div className="flex-1 overflow-y-auto px-2 pb-24 md:pb-3">
            {chatsLoading ? (
              <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-blue-400" aria-label="Loading chats" /></div>
            ) : filteredChats.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center justify-center space-y-3">
                <MessageSquare className="w-10 h-10 text-gray-600" />
                <p className="text-gray-500 text-sm">No {chatFilter === 'all' ? 'active' : chatFilter} chats found.</p>
                {chatFilter === 'all' && <button onClick={() => setShowNewChatModal(true)} className="px-4 py-2 bg-brand-gradient rounded-full text-sm font-semibold text-white cursor-pointer">Start New Chat</button>}
              </div>
            ) : (
              filteredChats.map((c) => {
                const isActive = activeChat?.id === c.id;
                // Grab matching profile for avatar
                const targetProfile = c.participants?.[0];
                return (
                  <div
                    key={c.id}
                    onClick={() => void openChat(c)}
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
                            {c.last_message || targetProfile?.status || 'No messages yet'}
                          </span>
                        </p>
                        
                        <div className="flex shrink-0 items-center gap-1.5">
                          {!!c.unread_count && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-gradient-to-r from-blue-600 to-red-600 px-1 text-[11px] font-bold text-white">{c.unread_count}</span>}
                          {c.is_favorite && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
                          {c.is_locked && <LockKeyhole className="h-4 w-4 text-[#aebac1]" />}
                        </div>
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
                  onClick={() => item.label !== 'Chats' && setUtilityPanel(item.label.toLowerCase() as 'updates' | 'communities' | 'calls')}
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
                      {activeTypingNames.length ? `${activeTypingNames.join(', ')} typing…` : activeChat.is_self ? 'Personal notes' : activeChatOnline ? 'Online' : activeChat.participants?.[0]?.status || `${activeChat.participants?.length || 0} members`}
                    </p>
                  </div>
                </div>

                <div className="relative flex items-center gap-4 text-[#aebac1]">
                  {!activeChat.is_self && <button type="button" title="Audio call" onClick={() => void callManager.startCall(activeChat.id, 'audio')} className="rounded-full p-2 transition hover:bg-[#2a302e] hover:text-white"><Phone className="h-5 w-5" /></button>}
                  {!activeChat.is_self && <button type="button" title="Video call" onClick={() => void callManager.startCall(activeChat.id, 'video')} className="rounded-full p-2 transition hover:bg-[#2a302e] hover:text-white"><Video className="h-5 w-5" /></button>}
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
                    onClick={() => setShowChatMenu((visible) => !visible)}
                    className="rounded-full p-2 transition hover:bg-[#2a302e] hover:text-white cursor-pointer"
                  >
                    <MoreVertical className="h-5 w-5" />
                  </button>
                  {showChatMenu && (
                    <div className="absolute right-0 top-11 z-40 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#202624] py-1 text-sm text-white shadow-2xl">
                      <button type="button" onClick={() => void toggleFavorite()} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/10">
                        <Star className={`h-4 w-4 ${activeChat.is_favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                        {activeChat.is_favorite ? 'Remove favorite' : 'Add to favorites'}
                      </button>
                      <button type="button" onClick={() => void toggleChatLock()} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/10">
                        {activeChat.is_locked ? <Unlock className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
                        {activeChat.is_locked ? 'Unlock chat' : 'Lock chat'}
                      </button>
                      <button type="button" onClick={() => void toggleArchive()} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/10">
                        <Archive className="h-4 w-4" /> {activeChat.is_archived ? 'Unarchive chat' : 'Archive chat'}
                      </button>
                      {activeChat.is_group && activeChat.member_role !== 'member' && (
                        <button type="button" onClick={() => openGroupEditor(activeChat)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/10">
                          <UsersRound className="h-4 w-4" /> Manage group
                        </button>
                      )}
                      {!activeChat.encryption_enabled ? (
                        <button type="button" onClick={() => void enableSharedSecretEncryption()} className="flex w-full items-center gap-3 px-4 py-3 text-left text-emerald-300 hover:bg-emerald-500/10"><ShieldCheck className="h-4 w-4" />Enable encrypted mode</button>
                      ) : <div className="px-4 py-2 text-[10px] text-emerald-300">AES-GCM shared-secret mode</div>}
                      {!activeChat.is_self && (
                        <button type="button" onClick={() => void toggleBlockActiveUser()} className="flex w-full items-center gap-3 px-4 py-3 text-left text-red-300 hover:bg-red-500/10">
                          <Ban className="h-4 w-4" /> {activeChat.is_blocked ? 'Unblock user' : 'Block user'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {latestPinnedMessage && (
                <button type="button" onClick={() => document.getElementById(`message-${latestPinnedMessage.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="flex h-12 items-center gap-6 border-b border-black/30 bg-[#1f2725]/90 px-8 text-left text-sm text-[#c8d0d4] hover:bg-[#26302d]">
                  <Pin className="h-4 w-4 shrink-0 text-blue-400" />
                  <span className="truncate">{latestPinnedMessage.content || (latestPinnedMessage.message_type === 'image' ? 'Pinned image' : 'Pinned voice message')}</span>
                </button>
              )}

              {/* Chat messages viewport */}
              <div ref={messagesViewportRef} onScroll={handleMessageScroll} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 chat-bg-pattern">
                {hasOlderMessages && !messagesLoading && (
                  <div className="flex justify-center">
                    <button type="button" disabled={olderMessagesLoading} onClick={() => void fetchMessages(activeChat.id, 'older')} className="rounded-full border border-white/10 bg-[#202624]/90 px-4 py-2 text-xs font-semibold text-gray-300 shadow hover:bg-[#29312e] disabled:opacity-60">
                      {olderMessagesLoading ? <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading older messages</span> : 'Load older messages'}
                    </button>
                  </div>
                )}
                {messagesLoading && <div className="flex h-32 flex-col items-center justify-center gap-3 text-sm text-gray-400"><Loader2 className="h-7 w-7 animate-spin text-blue-400" /><span>Loading recent messages…</span></div>}
                {!messagesLoading && messages.length === 0 && <div className="flex h-40 flex-col items-center justify-center gap-3 text-center text-gray-500"><MessageSquare className="h-9 w-9" /><div><p className="text-sm font-semibold text-gray-300">No messages yet</p><p className="mt-1 text-xs">Send the first message in this conversation.</p></div></div>}
                <AnimatePresence initial={false}>
                  {messages.map((message) => <MessageBubble key={message.id} message={message} chat={activeChat} currentUserId={user.id} actionOpen={messageActionId === message.id} reactionPickerOpen={reactingTo === message.id} onBeginLongPress={() => beginLongPress(message.id)} onCancelLongPress={cancelLongPress} onOpenActions={() => setMessageActionId(message.id)} onAction={(action) => void runMessageAction(message, action)} onToggleReactionPicker={() => setReactingTo((current) => current === message.id ? null : message.id)} onReaction={(emoji) => void toggleReaction(message, emoji)} />)}
                </AnimatePresence>
                
                <div ref={messagesEndRef} />
              </div>

              {actionError && (
                <div role="alert" className="flex items-center justify-between border-t border-red-500/20 bg-red-950/50 px-4 py-2 text-xs text-red-200">
                  <span>{actionError}</span>
                  <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss error"><X className="h-4 w-4" /></button>
                </div>
              )}
              {activeChat.is_blocked && (
                <div className="border-t border-amber-500/20 bg-amber-950/40 px-4 py-2 text-center text-xs text-amber-200">Unblock this user from the chat menu before sending messages.</div>
              )}
              {/* Chat composer */}
              <form onSubmit={handleSendMessage} className="relative flex min-h-[62px] items-center gap-2 bg-[#1f2725] px-3 py-2">
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleFileSelected} className="hidden" />
                <button
                  type="button"
                  title="Send an image"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || isRecording || activeChat.is_blocked}
                  className="rounded-full p-2.5 text-[#aebac1] transition hover:bg-[#2a302e] hover:text-white cursor-pointer"
                >
                  {isUploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Paperclip className="h-6 w-6" />}
                </button>
                <button
                  type="button"
                  title="Insert emoji"
                  onClick={() => setShowEmojiPicker((visible) => !visible)}
                  disabled={isRecording || activeChat.is_blocked}
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
                  onChange={(e) => handleMessageInput(e.target.value)}
                  disabled={isRecording || isUploading || activeChat.is_blocked}
                  maxLength={5000}
                  className="min-w-0 flex-1 rounded-xl border border-transparent bg-[#2a302e] px-4 py-3 text-sm text-white placeholder:text-[#aebac1] focus:border-blue-500/50 focus:outline-none"
                />

                <button
                  type={inputText.trim() ? 'submit' : 'button'}
                  onClick={inputText.trim() ? undefined : (isRecording ? stopRecording : () => void startRecording())}
                  disabled={isUploading || activeChat.is_blocked}
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

                <button type="button" onClick={() => { setShowNewChatModal(false); openGroupEditor(); }} className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 py-2.5 text-sm font-semibold text-blue-200 hover:bg-blue-500/20">
                  <UsersRound className="h-4 w-4" /> Create group conversation
                </button>

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

        <AnimatePresence>
          {showGroupModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
              <motion.form onSubmit={saveGroup} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="glass-container w-full max-w-lg rounded-3xl p-6 shadow-2xl">
                <div className="mb-5 flex items-center justify-between"><h3 className="flex items-center gap-2 text-lg font-bold"><UsersRound className="h-5 w-5 text-blue-400" />{groupEditChat ? 'Manage group' : 'Create group'}</h3><button type="button" onClick={() => setShowGroupModal(false)}><X className="h-5 w-5 text-gray-400" /></button></div>
                <label className="mb-4 block"><span className="mb-2 block text-xs font-semibold uppercase text-gray-400">Group name</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} required minLength={2} maxLength={100} className="glass-input w-full rounded-xl px-4 py-3" /></label>
                {groupEditChat?.participants?.length ? <div className="mb-4"><p className="mb-2 text-xs font-semibold uppercase text-gray-400">Current members</p><div className="flex flex-wrap gap-2">{groupEditChat.participants.map((member) => <span key={member.id} className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs">{member.display_name}<button type="button" onClick={() => void removeGroupMember(member)} className="text-red-300"><X className="h-3 w-3" /></button></span>)}</div></div> : null}
                <p className="mb-2 text-xs font-semibold uppercase text-gray-400">{groupEditChat ? 'Add members' : 'Select members'}</p>
                <div className="mb-5 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-white/10 p-2">{profiles.filter((entry) => !groupEditChat?.participants?.some((member) => member.id === entry.id)).map((entry) => <label key={entry.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-white/5"><input type="checkbox" checked={groupMemberIds.has(entry.id)} onChange={() => setGroupMemberIds((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })} /><img src={entry.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${entry.id}`} alt="" className="h-8 w-8 rounded-full" /><span className="text-sm">{entry.display_name}</span></label>)}</div>
                <button disabled={isUploading} className="flex w-full items-center justify-center rounded-xl bg-brand-gradient py-3 font-semibold text-white disabled:opacity-50">{isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : groupEditChat ? 'Save group' : 'Create group'}</button>
              </motion.form>
            </div>
          )}
        </AnimatePresence>

        <CallOverlay call={callManager.call} incomingCall={callManager.incomingCall} localStream={callManager.localStream} remoteStream={callManager.remoteStream} callerName={chats.find((chat) => chat.id === (callManager.incomingCall || callManager.call)?.chat_id)?.name || '3SChat user'} onAccept={() => void callManager.acceptCall()} onDecline={() => void callManager.declineCall()} onEnd={() => void callManager.endCall()} />
        {utilityPanel && <UtilityPanel mode={utilityPanel} userId={user.id} profile={profile} onClose={() => setUtilityPanel(null)} />}

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

                  <div className="space-y-3 border-t border-white/10 pt-4">
                    <p className="text-xs font-semibold uppercase text-[#aebac1]">Account recovery and identity</p>
                    <div className="flex gap-2"><input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#202c2f] px-3 py-2.5 text-sm" /><button type="button" onClick={() => void handleAccountChange('email')} className="rounded-xl border border-blue-500/30 px-3 text-xs text-blue-300">Change email</button></div>
                    <div className="flex gap-2"><input type="tel" value={editPhone} onChange={(event) => setEditPhone(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#202c2f] px-3 py-2.5 text-sm" /><button type="button" onClick={() => void handleAccountChange('phone')} className="rounded-xl border border-blue-500/30 px-3 text-xs text-blue-300">Change phone</button></div>
                    <p className="text-[10px] leading-relaxed text-gray-500">Email changes require confirmation. If you lose access, use the normal email-code login flow with your registered email.</p>
                    <PushNotificationButton />
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
