'use client';

import { Mic, PhoneOff, Video } from 'lucide-react';
import type { ChatCall } from '../../hooks/useWebRtcCall';

interface Props {
  call: ChatCall | null;
  incomingCall: ChatCall | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  callerName: string;
  onAccept: () => void;
  onDecline: () => void;
  onEnd: () => void;
}

export function CallOverlay({ call, incomingCall, localStream, remoteStream, callerName, onAccept, onDecline, onEnd }: Props) {
  if (!call && !incomingCall) return null;
  const active = call || incomingCall!;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/85 p-4 backdrop-blur-lg">
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-[#111614] p-8 text-center shadow-2xl">
        <div className="mx-auto mb-5 grid h-24 w-24 place-items-center rounded-full bg-brand-gradient text-3xl font-bold">{callerName.slice(0, 1).toUpperCase()}</div>
        <h2 className="text-2xl font-bold">{callerName}</h2>
        <p className="mt-1 text-sm text-gray-400">{incomingCall ? `Incoming ${active.call_type} call` : call?.status === 'accepted' ? 'Connected' : 'Calling…'}</p>
        {active.call_type === 'video' && <div className="relative mt-6 aspect-video overflow-hidden rounded-2xl bg-black"><video ref={(node) => { if (node && remoteStream) node.srcObject = remoteStream; }} autoPlay playsInline className="h-full w-full object-cover" /><video ref={(node) => { if (node && localStream) node.srcObject = localStream; }} autoPlay muted playsInline className="absolute bottom-3 right-3 h-28 w-36 rounded-xl border border-white/20 object-cover" /></div>}
        {active.call_type === 'audio' && <audio ref={(node) => { if (node && remoteStream) node.srcObject = remoteStream; }} autoPlay />}
        <div className="mt-7 flex justify-center gap-4">
          {incomingCall ? <><button type="button" onClick={onDecline} className="grid h-14 w-14 place-items-center rounded-full bg-red-500 text-white"><PhoneOff className="h-6 w-6" /></button><button type="button" onClick={onAccept} className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-white">{active.call_type === 'video' ? <Video className="h-6 w-6" /> : <Mic className="h-6 w-6" />}</button></> : <button type="button" onClick={onEnd} className="grid h-14 w-14 place-items-center rounded-full bg-red-500 text-white"><PhoneOff className="h-6 w-6" /></button>}
        </div>
      </div>
    </div>
  );
}
