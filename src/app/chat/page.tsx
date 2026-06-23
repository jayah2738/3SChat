'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Archive,
  BadgePlus,
  Camera,
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
  Sparkles
} from 'lucide-react';
import { 
  supabase, 
  IS_MOCK_MODE, 
  mockDb, 
  mockRealtime, 
  Profile, 
  Chat, 
  Message 
} from '../../lib/supabaseClient';

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

  // Input states
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newChatSearch, setNewChatSearch] = useState('');
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editAvatar, setEditAvatar] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Guard route: redirect if logged out
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Initialize edit fields when profile loads
  useEffect(() => {
    if (profile) {
      setEditName(profile.display_name || '');
      setEditStatus(profile.status || '');
      setEditAvatar(profile.avatar_url || '');
    }
  }, [profile]);

  // 2. Fetch chats list and other profiles
  const fetchChatsAndProfiles = async () => {
    if (!user) return;
    try {
      if (IS_MOCK_MODE) {
        const userChats = await mockDb.getChats(user.id);
        setChats(userChats);

        const otherProfiles = await mockDb.getAllProfiles(user.id);
        setProfiles(otherProfiles);
      } else {
        // Real Supabase queries
        // 1. Get user's chats
        const { data: participantsData, error: cpError } = await supabase
          .from('chat_participants')
          .select('chat_id')
          .eq('user_id', user.id);

        if (cpError) throw cpError;

        const chatIds = participantsData.map((cp: any) => cp.chat_id);

        if (chatIds.length > 0) {
          const { data: chatsData, error: chatsError } = await supabase
            .from('chats')
            .select('*, chat_participants(user_id, profiles(*))')
            .in('id', chatIds);

          if (chatsError) throw chatsError;

          // Process chat data to resolve name & participants list
          const formattedChats = chatsData.map((c: any) => {
            const listParticipants = c.chat_participants
              .filter((p: any) => p.user_id !== user.id)
              .map((p: any) => p.profiles);
            
            const chatName = c.is_group 
              ? c.name 
              : (listParticipants[0]?.display_name || 'Direct Chat');

            return {
              id: c.id,
              name: chatName,
              is_group: c.is_group,
              created_at: c.created_at,
              participants: listParticipants
            } as Chat;
          });

          setChats(formattedChats);
        } else {
          setChats([]);
        }

        // 2. Get other user profiles for new chat
        const { data: allProfiles, error: profsError } = await supabase
          .from('profiles')
          .select('*')
          .neq('id', user.id);

        if (profsError) throw profsError;
        setProfiles(allProfiles || []);
      }
    } catch (err) {
      console.error('Error fetching chats/profiles:', err);
    }
  };

  useEffect(() => {
    if (user) {
      fetchChatsAndProfiles();
    }
  }, [user]);

  // 3. Fetch messages for active chat
  const fetchMessages = async (chatId: string) => {
    try {
      if (IS_MOCK_MODE) {
        const msgs = await mockDb.getMessages(chatId);
        setMessages(msgs);
      } else {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        setMessages(data || []);
      }
      scrollToBottom();
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  };

  useEffect(() => {
    if (activeChat) {
      fetchMessages(activeChat.id);
    } else {
      setMessages([]);
    }
  }, [activeChat]);

  useEffect(() => {
    if (!activeChat && chats.length > 0) {
      setActiveChat(chats[0]);
    }
  }, [activeChat, chats]);

  // 4. Realtime subscriber for new messages
  useEffect(() => {
    if (!user) return;

    let unsubscribeFunc: (() => void) | null = null;

    const setupMessageListener = () => {
      if (IS_MOCK_MODE) {
        const sub = mockRealtime.subscribe('messages', user.id, (payload: Message) => {
          // If message is for the active chat, add to messages list
          if (activeChat && payload.chat_id === activeChat.id) {
            setMessages((prev) => [...prev, payload]);
            scrollToBottom();
          }
          // Refresh chat lists to update last message snippet
          fetchChatsAndProfiles();
        });
        unsubscribeFunc = sub.unsubscribe;
      } else {
        const channel = supabase
          .channel('global-messages')
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            async (payload: any) => {
              const newMsg = payload.new as Message;
              
              // Validate if user is participant of this chat before listing
              // (Since RLS handles read restrictions, client updates might receive event but we check active chat ID)
              if (activeChat && newMsg.chat_id === activeChat.id) {
                setMessages((prev) => [...prev, newMsg]);
                scrollToBottom();
              }
              fetchChatsAndProfiles();
            }
          )
          .subscribe();

        unsubscribeFunc = () => {
          supabase.removeChannel(channel);
        };
      }
    };

    setupMessageListener();

    return () => {
      if (unsubscribeFunc) unsubscribeFunc();
    };
  }, [user, activeChat]);

  // Scroll to bottom helper
  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // 5. Send message action
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChat || !user) return;

    const textToSend = inputText;
    setInputText('');

    try {
      if (IS_MOCK_MODE) {
        const newMsg = await mockDb.sendMessage(activeChat.id, user.id, textToSend);
        setMessages((prev) => [...prev, newMsg]);
        scrollToBottom();
        // Refresh chats to update snippets
        fetchChatsAndProfiles();
      } else {
        const { data, error } = await supabase
          .from('messages')
          .insert({
            chat_id: activeChat.id,
            sender_id: user.id,
            content: textToSend
          })
          .select()
          .single();

        if (error) throw error;
        
        // Optimistic update
        setMessages((prev) => [...prev, data]);
        scrollToBottom();
        fetchChatsAndProfiles();
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  // 6. Start new chat action
  const handleStartChat = async (targetUser: Profile) => {
    if (!user) return;

    try {
      if (IS_MOCK_MODE) {
        const newChat = await mockDb.createChat(user.id, targetUser.id);
        setActiveChat(newChat);
        setShowNewChatModal(false);
        setMobileView('chat');
        fetchChatsAndProfiles();
      } else {
        // Real Supabase start chat
        // Check if there is an existing direct chat
        const { data: existingChats, error: queryError } = await supabase
          .rpc('get_direct_chat_with_user', { target_user_id: targetUser.id });

        if (!queryError && existingChats && existingChats.length > 0) {
          const chatDetails: Chat = {
            id: existingChats[0].chat_id,
            name: targetUser.display_name,
            is_group: false,
            created_at: new Date().toISOString(),
            participants: [targetUser]
          };
          setActiveChat(chatDetails);
        } else {
          // Create new chat
          const { data: chatData, error: chatError } = await supabase
            .from('chats')
            .insert({ is_group: false })
            .select()
            .single();

          if (chatError) throw chatError;

          // Add participants
          const participants = [
            { chat_id: chatData.id, user_id: user.id },
            { chat_id: chatData.id, user_id: targetUser.id }
          ];

          const { error: pError } = await supabase
            .from('chat_participants')
            .insert(participants);

          if (pError) throw pError;

          const newChatDetails: Chat = {
            id: chatData.id,
            name: targetUser.display_name,
            is_group: false,
            created_at: chatData.created_at,
            participants: [targetUser]
          };

          setActiveChat(newChatDetails);
        }

        setShowNewChatModal(false);
        setMobileView('chat');
        fetchChatsAndProfiles();
      }
    } catch (err) {
      console.error('Failed to start chat:', err);
    }
  };

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
                        <span className={`mt-1 shrink-0 text-xs ${!isActive && c.id === 'chat-demo-2' ? 'text-red-400' : 'text-[#aebac1]'}`}>
                          {formatChatTime(c.created_at)}
                        </span>
                      </div>
                      
                      <div className="mt-0.5 flex items-center justify-between gap-3">
                        <p className="flex min-w-0 items-center gap-1.5 truncate text-sm text-[#aebac1]">
                          {c.id === 'chat-demo-2' ? (
                            <Mic className="h-4 w-4 shrink-0 text-blue-400" />
                          ) : (
                            <CheckCheck className="h-4 w-4 shrink-0 text-gray-500" />
                          )}
                          <span className="truncate">
                            {targetProfile?.status || 'You pinned a message'}
                          </span>
                        </p>
                        
                        {!isActive && c.id === 'chat-demo-2' && (
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-gradient-to-r from-blue-600 to-red-600 px-1.5 text-[11px] font-bold text-white">
                            1
                          </span>
                        )}
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
                  {activeChat.participants?.[0]?.status || 'password twilio; @Haja262'}
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
                          className={`max-w-[78%] rounded-2xl px-4 py-2.5 shadow-md relative ${
                            isOutgoing 
                              ? 'bubble-outgoing text-white' 
                              : 'bubble-incoming text-gray-200'
                          }`}
                        >
                          <p className="text-sm leading-relaxed whitespace-pre-wrap select-text break-words">
                            {m.content}
                          </p>
                          <div className="flex items-center justify-end space-x-1 mt-1">
                            <span className="text-[9px] text-white/50 block select-none">
                              {messageTime}
                            </span>
                            {isOutgoing && (
                              <CheckCheck className="w-3.5 h-3.5 text-blue-300 shrink-0" />
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                
                <div ref={messagesEndRef} />
              </div>

              {/* Chat send textbar */}
              <form 
                onSubmit={handleSendMessage}
                className="flex h-[62px] items-center gap-3 bg-[#1f2725] px-3"
              >
                <button
                  type="button"
                  title="Add attachment"
                  className="rounded-full p-2.5 text-[#aebac1] transition hover:bg-[#2a302e] hover:text-white cursor-pointer"
                >
                  <Plus className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  title="Insert Emojis (Simulated)"
                  onClick={() => setInputText((prev) => prev + ' :)')}
                  className="rounded-full p-2.5 text-[#aebac1] transition hover:bg-[#2a302e] hover:text-white cursor-pointer"
                >
                  <Smile className="h-6 w-6" />
                </button>
                
                <input 
                  type="text"
                  placeholder="Type a message"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-transparent bg-[#2a302e] px-4 py-3 text-sm text-white placeholder:text-[#aebac1] focus:border-blue-500/50 focus:outline-none"
                />

                <button
                  type="submit"
                  className={`rounded-full p-2.5 transition cursor-pointer ${
                    inputText.trim()
                      ? 'bg-brand-gradient text-white shadow-md shadow-blue-500/10 hover:opacity-95'
                      : 'text-[#aebac1] hover:bg-[#2a302e] hover:text-white'
                  }`}
                >
                  {inputText.trim() ? <Send className="h-5 w-5" /> : <Mic className="h-6 w-6" />}
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
                    <h4 className="text-xs font-bold text-white">Encrypted Schema</h4>
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
                            src={p.avatar_url} 
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
