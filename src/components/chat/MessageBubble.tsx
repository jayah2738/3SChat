'use client';
/* eslint-disable @next/next/no-img-element -- private signed media URLs are dynamic */

import { motion } from 'framer-motion';
import { CheckCheck, Flag, Mic, Pencil, Pin, Smile, Trash2 } from 'lucide-react';
import type { Chat, Message } from '../../lib/supabaseClient';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
type MessageAction = 'pin' | 'edit' | 'delete' | 'report';

interface Props {
  message: Message;
  chat: Chat;
  currentUserId: string;
  actionOpen: boolean;
  reactionPickerOpen: boolean;
  onBeginLongPress: () => void;
  onCancelLongPress: () => void;
  onOpenActions: () => void;
  onAction: (action: MessageAction) => void;
  onToggleReactionPicker: () => void;
  onReaction: (emoji: string) => void;
}

export function MessageBubble({ message, chat, currentUserId, actionOpen, reactionPickerOpen, onBeginLongPress, onCancelLongPress, onOpenActions, onAction, onToggleReactionPicker, onReaction }: Props) {
  const outgoing = message.sender_id === currentUserId;
  const readCount = message.receipts?.filter((receipt) => !!receipt.read_at).length || 0;
  const expectedReaders = chat.is_self ? 0 : (chat.participants?.length || 0);
  const fullyRead = chat.is_self || (expectedReaders > 0 && readCount >= expectedReaders);
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return <motion.div id={`message-${message.id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`} onPointerDown={() => !message.deleted_at && onBeginLongPress()} onPointerUp={onCancelLongPress} onPointerLeave={onCancelLongPress} onPointerCancel={onCancelLongPress} onContextMenu={(event) => { event.preventDefault(); if (!message.deleted_at) onOpenActions(); }}>
    <div className={`group/message relative max-w-[88%] rounded-2xl px-3 py-2.5 shadow-md sm:max-w-[78%] sm:px-4 ${outgoing ? 'bubble-outgoing text-white' : 'bubble-incoming text-gray-200'}`}>
      {message.deleted_at ? <p className="text-sm italic text-white/50">This message was deleted</p> : message.message_type === 'image' && message.media_url ? <a href={message.media_url} target="_blank" rel="noreferrer" className="mb-2 block overflow-hidden rounded-xl"><img src={message.media_url} alt={message.content || 'Shared image'} className="max-h-80 w-full object-contain" loading="lazy" /></a> : message.message_type === 'voice' && message.media_url ? <div className="mb-1 flex min-w-[220px] items-center gap-2"><Mic className="h-5 w-5 shrink-0 text-blue-300" /><audio controls preload="metadata" src={message.media_url} className="h-9 min-w-0 flex-1" />{message.duration_seconds && <span className="text-[10px] text-white/60">{message.duration_seconds}s</span>}</div> : null}
      {!message.deleted_at && message.content && message.message_type !== 'voice' && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed select-text">{message.content}</p>}
      {message.decryption_failed && <p className="text-xs italic text-amber-200">Encrypted message — reopen the chat with the correct shared secret.</p>}
      {!message.deleted_at && message.message_type !== 'text' && !message.media_url && <p className="text-xs text-amber-200">Media link expired. Refresh the conversation.</p>}
      <div className="mt-1 flex items-center justify-end space-x-1">{message.is_pinned && <Pin className="h-3 w-3 text-blue-300" />}{message.edited_at && !message.deleted_at && <span className="text-[9px] text-white/40">edited</span>}{message.pending && <span className="text-[9px] text-amber-200">queued</span>}<span className="text-[9px] text-white/50">{time}</span>{outgoing && <span title={expectedReaders > 1 ? `${readCount} of ${expectedReaders} members read` : fullyRead ? 'Read' : 'Delivered'} className="flex items-center gap-0.5"><CheckCheck className={`h-3.5 w-3.5 ${fullyRead ? 'text-blue-300' : 'text-white/40'}`} />{expectedReaders > 1 && <span className="text-[8px] text-white/40">{readCount}/{expectedReaders}</span>}</span>}</div>
      {actionOpen && <div className={`absolute top-full z-40 mt-2 min-w-36 overflow-hidden rounded-xl border border-white/10 bg-[#202624] py-1 text-sm shadow-2xl ${outgoing ? 'right-0' : 'left-0'}`}><Action icon={Pin} label={message.is_pinned ? 'Unpin' : 'Pin'} onClick={() => onAction('pin')} />{outgoing && message.message_type === 'text' && !message.encrypted_content && <Action icon={Pencil} label="Edit" onClick={() => onAction('edit')} />}{outgoing && <Action icon={Trash2} label="Delete" danger onClick={() => onAction('delete')} />}{!outgoing && <Action icon={Flag} label="Report" warning onClick={() => onAction('report')} />}</div>}
      <button type="button" onClick={onToggleReactionPicker} title="React to message" className={`absolute -top-3 ${outgoing ? '-left-8' : '-right-8'} rounded-full bg-[#26302d] p-1.5 text-[#aebac1] opacity-0 shadow hover:text-white group-hover/message:opacity-100 ${message.deleted_at ? 'hidden' : ''}`}><Smile className="h-4 w-4" /></button>
      {reactionPickerOpen && <div className={`absolute -top-11 z-30 flex gap-1 rounded-full border border-white/10 bg-[#202624] p-1.5 shadow-xl ${outgoing ? 'right-0' : 'left-0'}`}>{REACTIONS.map((emoji) => <button key={emoji} type="button" onClick={() => onReaction(emoji)} className="rounded-full p-1 text-lg hover:scale-125 hover:bg-white/10">{emoji}</button>)}</div>}
      {!!message.reactions?.length && <div className={`absolute -bottom-4 flex gap-1 ${outgoing ? 'right-2' : 'left-2'}`}>{Array.from(new Set(message.reactions.map((reaction) => reaction.emoji))).map((emoji) => { const count = message.reactions?.filter((reaction) => reaction.emoji === emoji).length || 0; const mine = message.reactions?.some((reaction) => reaction.emoji === emoji && reaction.user_id === currentUserId); return <button key={emoji} type="button" onClick={() => onReaction(emoji)} className={`rounded-full border px-1.5 py-0.5 text-xs shadow ${mine ? 'border-blue-400/60 bg-blue-500/20' : 'border-white/10 bg-[#202624]'}`}>{emoji}{count > 1 ? ` ${count}` : ''}</button>; })}</div>}
    </div>
  </motion.div>;
}

function Action({ icon: Icon, label, onClick, danger, warning }: { icon: typeof Pin; label: string; onClick: () => void; danger?: boolean; warning?: boolean }) {
  return <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 ${danger ? 'text-red-300' : warning ? 'text-amber-300' : ''}`}><Icon className="h-4 w-4" />{label}</button>;
}
