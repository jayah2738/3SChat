import type { Chat } from './supabaseClient';

export type ChatFilterValue = 'all' | 'unread' | 'favorites' | 'groups' | 'locked' | 'archived';

export function filterChats(chats: Chat[], filter: ChatFilterValue, search: string) {
  const query = search.trim().toLowerCase();
  return chats.filter((chat) => {
    if (chat.is_self || !chat.name.toLowerCase().includes(query)) return false;
    if (filter === 'locked') return !!chat.is_locked;
    if (filter === 'archived') return !!chat.is_archived;
    if (chat.is_archived || chat.is_locked) return false;
    if (filter === 'unread') return (chat.unread_count || 0) > 0;
    if (filter === 'favorites') return !!chat.is_favorite;
    if (filter === 'groups') return chat.is_group;
    return true;
  });
}

export function unreadTotal(chats: Chat[]) {
  return chats.reduce((total, chat) => total + (chat.unread_count || 0), 0);
}
