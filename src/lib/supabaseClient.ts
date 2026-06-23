import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Detect if we should use Mock Mode
export const IS_MOCK_MODE = 
  !supabaseUrl || 
  !supabaseAnonKey || 
  supabaseUrl.includes('your_supabase') || 
  supabaseAnonKey.includes('your_supabase');

if (IS_MOCK_MODE) {
  console.warn(
    '3SChat: Running in DEMO/MOCK mode. Provide NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local for production.'
  );
}

// ----------------------------------------------------
// Real Supabase Client
// ----------------------------------------------------
export const supabase = !IS_MOCK_MODE
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (null as any);

// ----------------------------------------------------
// Types matching Supabase responses
// ----------------------------------------------------
export interface Profile {
  id: string;
  phone_number: string;
  display_name: string;
  avatar_url: string;
  status: string;
  last_seen: string;
}

export interface Chat {
  id: string;
  name: string;
  is_group: boolean;
  created_at: string;
  participants?: Profile[];
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  media_url?: string;
  created_at: string;
  is_read: boolean;
}

export interface UserSession {
  id: string;
  user_id: string;
  active_device_id: string;
  updated_at: string;
}

// ----------------------------------------------------
// LocalStorage Mock Implementation
// ----------------------------------------------------
// Helper keys for mock data
const MOCK_USERS_KEY = '3schat_mock_users';
const MOCK_PROFILES_KEY = '3schat_mock_profiles';
const MOCK_CHATS_KEY = '3schat_mock_chats';
const MOCK_PARTICIPANTS_KEY = '3schat_mock_participants';
const MOCK_MESSAGES_KEY = '3schat_mock_messages';
const MOCK_SESSIONS_KEY = '3schat_mock_sessions';
const MOCK_CURRENT_USER_KEY = '3schat_mock_current_user';

// Mock storage getters and setters
const getStorage = (key: string, fallback: any) => {
  if (typeof window === 'undefined') return fallback;
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : fallback;
};

const setStorage = (key: string, data: any) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(data));
};

// Seed mock profiles if empty
export const seedMockData = () => {
  if (typeof window === 'undefined') return;
  
  const existingProfiles = getStorage(MOCK_PROFILES_KEY, []);
  if (existingProfiles.length === 0) {
    const demoProfiles: Profile[] = [
      {
        id: 'user-demo-1',
        phone_number: '+1234567890',
        display_name: 'Sarah Connor',
        avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=sarah',
        status: 'Fighting the machines 🤖',
        last_seen: new Date().toISOString()
      },
      {
        id: 'user-demo-2',
        phone_number: '+9876543210',
        display_name: 'Tony Stark',
        avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=tony',
        status: 'I am Iron Man 🕶️',
        last_seen: new Date().toISOString()
      },
      {
        id: 'user-demo-3',
        phone_number: '+5555555555',
        display_name: 'Neo',
        avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=neo',
        status: 'Follow the white rabbit 🐇',
        last_seen: new Date().toISOString()
      }
    ];
    setStorage(MOCK_PROFILES_KEY, demoProfiles);

    // Create a default chat between Sarah and Tony
    const demoChats: Chat[] = [
      {
        id: 'chat-demo-1',
        name: 'Sarah Connor',
        is_group: false,
        created_at: new Date().toISOString()
      },
      {
        id: 'chat-demo-2',
        name: 'Neo',
        is_group: false,
        created_at: new Date().toISOString()
      }
    ];
    setStorage(MOCK_CHATS_KEY, demoChats);

    const demoParticipants = [
      { chat_id: 'chat-demo-1', user_id: 'user-demo-1' },
      { chat_id: 'chat-demo-1', user_id: 'user-demo-2' }, // Tony is the viewer when logged in, or we bind dynamically
      { chat_id: 'chat-demo-2', user_id: 'user-demo-3' }
    ];
    setStorage(MOCK_PARTICIPANTS_KEY, demoParticipants);

    const demoMessages: Message[] = [
      {
        id: 'msg-1',
        chat_id: 'chat-demo-1',
        sender_id: 'user-demo-1',
        content: 'Tony, we need to prepare for Judgement Day. The server architecture must be decentralised.',
        created_at: new Date(Date.now() - 3600000).toISOString(),
        is_read: true
      },
      {
        id: 'msg-2',
        chat_id: 'chat-demo-1',
        sender_id: 'user-demo-2',
        content: 'Relax, Sarah. I’ve deployed a quantum firewall. 3SChat is unhackable.',
        created_at: new Date(Date.now() - 1800000).toISOString(),
        is_read: true
      },
      {
        id: 'msg-3',
        chat_id: 'chat-demo-2',
        sender_id: 'user-demo-3',
        content: 'Are you ready to see how deep the rabbit hole goes?',
        created_at: new Date(Date.now() - 600000).toISOString(),
        is_read: false
      }
    ];
    setStorage(MOCK_MESSAGES_KEY, demoMessages);
  }
};

// Realtime emitter simulator
type Listener = (payload: any) => void;
const realtimeListeners: { [table: string]: { [userId: string]: Listener[] } } = {};

export const mockRealtime = {
  subscribe: (table: string, userId: string, callback: Listener) => {
    if (!realtimeListeners[table]) realtimeListeners[table] = {};
    if (!realtimeListeners[table][userId]) realtimeListeners[table][userId] = [];
    realtimeListeners[table][userId].push(callback);

    return {
      unsubscribe: () => {
        realtimeListeners[table][userId] = realtimeListeners[table][userId].filter(cb => cb !== callback);
      }
    };
  },
  emit: (table: string, userId: string, payload: any) => {
    if (realtimeListeners[table] && realtimeListeners[table][userId]) {
      realtimeListeners[table][userId].forEach(callback => callback(payload));
    }
  }
};

// ----------------------------------------------------
// Mock Auth Services
// ----------------------------------------------------
export const mockAuth = {
  signUp: async (phoneNumber: string, displayName: string) => {
    seedMockData();
    const profiles = getStorage(MOCK_PROFILES_KEY, []);
    const existing = profiles.find((p: Profile) => p.phone_number === phoneNumber);

    if (existing) {
      return { data: { user: { id: existing.id, phone: phoneNumber } }, error: null as any };
    }

    const newId = `user-mock-${Math.random().toString(36).substr(2, 9)}`;
    const newProfile: Profile = {
      id: newId,
      phone_number: phoneNumber,
      display_name: displayName || `User_${phoneNumber.slice(-4)}`,
      avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(phoneNumber)}`,
      status: 'Hey there! I am using 3SChat.',
      last_seen: new Date().toISOString()
    };

    setStorage(MOCK_PROFILES_KEY, [...profiles, newProfile]);
    return { data: { user: { id: newId, phone: phoneNumber } }, error: null as any };
  },

  signInWithOTP: async (phoneNumber: string) => {
    seedMockData();
    // Simulate OTP generation
    const mockOTP = '123456';
    return { data: { otp: mockOTP }, error: null as any };
  },

  verifyOTP: async (phoneNumber: string, code: string) => {
    if (code !== '123456') {
      return { data: null, error: new Error('Invalid verification code.') };
    }

    const profiles = getStorage(MOCK_PROFILES_KEY, []);
    let userProfile = profiles.find((p: Profile) => p.phone_number === phoneNumber);

    if (!userProfile) {
      // Auto register demo users
      const result = await mockAuth.signUp(phoneNumber, `User_${phoneNumber.slice(-4)}`);
      userProfile = profiles.find((p: Profile) => p.phone_number === phoneNumber) || {
        id: result.data?.user?.id || 'mock-id',
        phone_number: phoneNumber,
        display_name: `User_${phoneNumber.slice(-4)}`,
        avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${phoneNumber}`,
        status: 'Hey there! I am using 3SChat.',
        last_seen: new Date().toISOString()
      };
    }

    const sessionObj = {
      user: { id: userProfile.id, phone: phoneNumber, user_metadata: { display_name: userProfile.display_name, avatar_url: userProfile.avatar_url } }
    };
    setStorage(MOCK_CURRENT_USER_KEY, sessionObj);
    return { data: sessionObj, error: null as any };
  },

  signOut: async () => {
    const session = getStorage(MOCK_CURRENT_USER_KEY, null);
    if (session) {
      const sessions = getStorage(MOCK_SESSIONS_KEY, []);
      const updatedSessions = sessions.filter((s: UserSession) => s.user_id !== session.user.id);
      setStorage(MOCK_SESSIONS_KEY, updatedSessions);
    }
    localStorage.removeItem(MOCK_CURRENT_USER_KEY);
    return { error: null as any };
  },

  getUser: async () => {
    const session = getStorage(MOCK_CURRENT_USER_KEY, null);
    return { data: { user: session ? session.user : null } };
  }
};

// ----------------------------------------------------
// Mock Database Operations
// ----------------------------------------------------
export const mockDb = {
  getProfile: async (userId: string): Promise<Profile | null> => {
    const profiles = getStorage(MOCK_PROFILES_KEY, []);
    return profiles.find((p: Profile) => p.id === userId) || null;
  },

  getAllProfiles: async (excludeUserId: string): Promise<Profile[]> => {
    const profiles = getStorage(MOCK_PROFILES_KEY, []);
    return profiles.filter((p: Profile) => p.id !== excludeUserId);
  },

  getChats: async (userId: string): Promise<Chat[]> => {
    seedMockData();
    const chats = getStorage(MOCK_CHATS_KEY, []);
    const participants = getStorage(MOCK_PARTICIPANTS_KEY, []);
    const profiles = getStorage(MOCK_PROFILES_KEY, []);

    // Filter chats where user is participant
    const userChatIds = participants
      .filter((p: any) => p.user_id === userId)
      .map((p: any) => p.chat_id);

    const userChats = chats.filter((c: Chat) => userChatIds.includes(c.id));

    // Hydrate participants
    return userChats.map((c: Chat) => {
      const chatParticipantIds = participants
        .filter((p: any) => p.chat_id === c.id && p.user_id !== userId)
        .map((p: any) => p.user_id);
      
      const chatParticipants = profiles.filter((p: Profile) => chatParticipantIds.includes(p.id));
      
      // WhatsApp detail: Chat title is the participant name for 1-on-1 chats
      const displayName = c.is_group ? c.name : (chatParticipants[0]?.display_name || 'Unknown User');
      
      return {
        ...c,
        name: displayName,
        participants: chatParticipants
      };
    });
  },

  createChat: async (currentUserId: string, targetUserId: string, name?: string, isGroup = false): Promise<Chat> => {
    const chats = getStorage(MOCK_CHATS_KEY, []);
    const participants = getStorage(MOCK_PARTICIPANTS_KEY, []);
    const profiles = getStorage(MOCK_PROFILES_KEY, []);

    // Check if 1-1 chat already exists
    if (!isGroup) {
      const existingChatId = participants.reduce((acc: string | null, curr: any) => {
        if (acc) return acc;
        if (curr.user_id === currentUserId) {
          const match = participants.find((p: any) => p.chat_id === curr.chat_id && p.user_id === targetUserId);
          if (match) return curr.chat_id;
        }
        return null;
      }, null);

      if (existingChatId) {
        const chat = chats.find((c: Chat) => c.id === existingChatId);
        const targetProfile = profiles.find((p: Profile) => p.id === targetUserId);
        return {
          ...chat,
          name: targetProfile?.display_name || 'Chat',
          participants: [targetProfile].filter(Boolean) as Profile[]
        };
      }
    }

    const newChatId = `chat-mock-${Math.random().toString(36).substr(2, 9)}`;
    const targetProfile = profiles.find((p: Profile) => p.id === targetUserId);
    const newChat: Chat = {
      id: newChatId,
      name: isGroup ? (name || 'Group Chat') : (targetProfile?.display_name || 'Chat'),
      is_group: isGroup,
      created_at: new Date().toISOString()
    };

    setStorage(MOCK_CHATS_KEY, [...chats, newChat]);

    const newParticipants = [
      { chat_id: newChatId, user_id: currentUserId }
    ];
    if (targetUserId) {
      newParticipants.push({ chat_id: newChatId, user_id: targetUserId });
    }
    setStorage(MOCK_PARTICIPANTS_KEY, [...participants, ...newParticipants]);

    return {
      ...newChat,
      participants: targetProfile ? [targetProfile] : []
    };
  },

  getMessages: async (chatId: string): Promise<Message[]> => {
    const messages = getStorage(MOCK_MESSAGES_KEY, []);
    return messages
      .filter((m: Message) => m.chat_id === chatId)
      .sort((a: Message, b: Message) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  },

  sendMessage: async (chatId: string, senderId: string, content: string): Promise<Message> => {
    const messages = getStorage(MOCK_MESSAGES_KEY, []);
    const newMessage: Message = {
      id: `msg-mock-${Math.random().toString(36).substr(2, 9)}`,
      chat_id: chatId,
      sender_id: senderId,
      content,
      created_at: new Date().toISOString(),
      is_read: false
    };

    const updated = [...messages, newMessage];
    setStorage(MOCK_MESSAGES_KEY, updated);

    // Trigger realtime simulators for any active chats
    const participants = getStorage(MOCK_PARTICIPANTS_KEY, []);
    const otherParticipants = participants.filter((p: any) => p.chat_id === chatId && p.user_id !== senderId);
    
    // Simulate automated response in demo mode after 2s for interactive feel
    otherParticipants.forEach((p: any) => {
      mockRealtime.emit('messages', p.user_id, newMessage);
    });

    // Simulated reply trigger (micro-interaction)
    setTimeout(() => {
      simulateReply(chatId, senderId, content);
    }, 1500);

    return newMessage;
  },

  // ----------------------------------------------------
  // Single Device Session Helpers (Mock)
  // ----------------------------------------------------
  updateSession: async (userId: string, deviceId: string): Promise<UserSession> => {
    const sessions = getStorage(MOCK_SESSIONS_KEY, []);
    const existingIndex = sessions.findIndex((s: UserSession) => s.user_id === userId);
    
    const sessionObj: UserSession = {
      id: existingIndex !== -1 ? sessions[existingIndex].id : `sess-${Math.random().toString(36).substr(2, 9)}`,
      user_id: userId,
      active_device_id: deviceId,
      updated_at: new Date().toISOString()
    };

    if (existingIndex !== -1) {
      sessions[existingIndex] = sessionObj;
    } else {
      sessions.push(sessionObj);
    }

    setStorage(MOCK_SESSIONS_KEY, sessions);
    
    // Trigger realtime session change notification for other sessions checking
    mockRealtime.emit('user_sessions', userId, sessionObj);

    return sessionObj;
  },

  getSession: async (userId: string): Promise<UserSession | null> => {
    const sessions = getStorage(MOCK_SESSIONS_KEY, []);
    return sessions.find((s: UserSession) => s.user_id === userId) || null;
  }
};

// Simulate automated bot replies to make the layout feel alive
const simulateReply = (chatId: string, originalSenderId: string, userMessage: string) => {
  const participants = getStorage(MOCK_PARTICIPANTS_KEY, []);
  const profiles = getStorage(MOCK_PROFILES_KEY, []);
  
  // Find the other participant in this chat
  const otherP = participants.find((p: any) => p.chat_id === chatId && p.user_id !== originalSenderId);
  if (!otherP) return;

  const botProfile = profiles.find((p: Profile) => p.id === otherP.user_id);
  if (!botProfile) return;

  // Simple chatbot dialog responses
  let replyText = `That's interesting! I'm secure here on 3SChat. Gradient theme is amazing.`;
  const lowerMsg = userMessage.toLowerCase();
  
  if (lowerMsg.includes('hello') || lowerMsg.includes('hi')) {
    replyText = `Hello! Hope you are liking the premium blue-red gradient design of 3SChat! 👋`;
  } else if (lowerMsg.includes('secure') || lowerMsg.includes('hack')) {
    replyText = `3SChat uses strict session locks. If you sign in on another browser/device with this phone number, I will be kicked out immediately! Try it!`;
  } else if (lowerMsg.includes('whatsapp')) {
    replyText = `Yes, we styled this with premium Tailwind details inspired by WhatsApp Web but boosted with animations!`;
  } else if (lowerMsg.includes('sarah')) {
    replyText = `I am Connor. The future isn’t set. There is no fate but what we make.`;
  } else if (lowerMsg.includes('tony') || lowerMsg.includes('iron')) {
    replyText = `Sometimes you gotta run before you can walk. By the way, check the single-device login feature. It is ironclad! 🦾`;
  }

  const messages = getStorage(MOCK_MESSAGES_KEY, []);
  const botMessage: Message = {
    id: `msg-mock-${Math.random().toString(36).substr(2, 9)}`,
    chat_id: chatId,
    sender_id: botProfile.id,
    content: replyText,
    created_at: new Date().toISOString(),
    is_read: false
  };

  setStorage(MOCK_MESSAGES_KEY, [...messages, botMessage]);
  
  // Emit realtime notification so active chats instantly fetch
  mockRealtime.emit('messages', originalSenderId, botMessage);
};
