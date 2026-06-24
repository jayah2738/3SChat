import { describe, expect, it } from 'vitest';
import { filterChats, unreadTotal } from './chatUtils';
import type { Chat } from './supabaseClient';

const chats: Chat[] = [
  { id: '1', name: 'Alice', is_group: false, created_at: '', unread_count: 2 },
  { id: '2', name: 'Team', is_group: true, created_at: '', is_favorite: true },
  { id: '3', name: 'Locked', is_group: false, created_at: '', is_locked: true },
  { id: '4', name: 'Archived', is_group: false, created_at: '', is_archived: true },
];

describe('chat filters', () => {
  it('uses real unread counts', () => expect(unreadTotal(chats)).toBe(2));
  it('hides locked and archived chats from All', () => expect(filterChats(chats, 'all', '')).toHaveLength(2));
  it('returns group and favorite data', () => {
    expect(filterChats(chats, 'groups', '')[0].name).toBe('Team');
    expect(filterChats(chats, 'favorites', '')[0].name).toBe('Team');
  });
});
