'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export interface ChatCall {
  id: string;
  chat_id: string;
  initiated_by: string;
  call_type: 'audio' | 'video';
  status: 'ringing' | 'accepted' | 'declined' | 'ended' | 'missed';
  offer_sdp: RTCSessionDescriptionInit | null;
  answer_sdp: RTCSessionDescriptionInit | null;
  started_at: string;
}

const rtcConfiguration: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    ...(process.env.NEXT_PUBLIC_TURN_URL ? [{
      urls: process.env.NEXT_PUBLIC_TURN_URL,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    }] : []),
  ],
};

export function useWebRtcCall(userId?: string) {
  const [call, setCall] = useState<ChatCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<ChatCall | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const callRef = useRef<ChatCall | null>(null);
  const remoteDescriptionSet = useRef(false);

  useEffect(() => { callRef.current = call; }, [call]);

  const cleanup = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setCall(null);
    setIncomingCall(null);
    remoteDescriptionSet.current = false;
  }, [localStream]);

  const createPeer = useCallback(async (callId: string, type: 'audio' | 'video') => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
    const peer = new RTCPeerConnection(rtcConfiguration);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.ontrack = (event) => setRemoteStream(event.streams[0]);
    peer.onicecandidate = (event) => {
      if (event.candidate && userId) {
        void supabase.from('call_ice_candidates').insert({ call_id: callId, user_id: userId, candidate: event.candidate.toJSON() });
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') setError('The call connection failed. Configure a TURN server for restrictive networks.');
    };
    peerRef.current = peer;
    setLocalStream(stream);
    return peer;
  }, [userId]);

  const startCall = useCallback(async (chatId: string, type: 'audio' | 'video' = 'audio') => {
    if (!userId || callRef.current) return;
    setError(null);
    try {
      const { data, error: insertError } = await supabase.from('calls').insert({ chat_id: chatId, initiated_by: userId, call_type: type }).select().single();
      if (insertError) throw insertError;
      const nextCall = data as ChatCall;
      setCall(nextCall);
      const peer = await createPeer(nextCall.id, type);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const { error: updateError } = await supabase.from('calls').update({ offer_sdp: offer }).eq('id', nextCall.id);
      if (updateError) throw updateError;
      setCall({ ...nextCall, offer_sdp: offer });
    } catch (cause) {
      cleanup();
      setError(cause instanceof Error ? cause.message : 'Unable to start the call.');
    }
  }, [cleanup, createPeer, userId]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall?.offer_sdp || !userId) return;
    setError(null);
    try {
      setCall(incomingCall);
      const peer = await createPeer(incomingCall.id, incomingCall.call_type);
      await peer.setRemoteDescription(incomingCall.offer_sdp);
      remoteDescriptionSet.current = true;
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      const { error: updateError } = await supabase.from('calls').update({ status: 'accepted', answer_sdp: answer, answered_at: new Date().toISOString() }).eq('id', incomingCall.id);
      if (updateError) throw updateError;
      setIncomingCall(null);
      setCall({ ...incomingCall, status: 'accepted', answer_sdp: answer });
    } catch (cause) {
      cleanup();
      setError(cause instanceof Error ? cause.message : 'Unable to answer the call.');
    }
  }, [cleanup, createPeer, incomingCall, userId]);

  const declineCall = useCallback(async () => {
    if (!incomingCall) return;
    await supabase.from('calls').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', incomingCall.id);
    setIncomingCall(null);
  }, [incomingCall]);

  const endCall = useCallback(async () => {
    if (callRef.current) await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', callRef.current.id);
    cleanup();
  }, [cleanup]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`calls-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, async ({ new: value }) => {
        const changed = value as ChatCall;
        if (!changed?.id) return;
        if (changed.initiated_by !== userId && changed.status === 'ringing' && changed.offer_sdp && !callRef.current) setIncomingCall(changed);
        if (changed.initiated_by === userId && changed.answer_sdp && peerRef.current && !remoteDescriptionSet.current) {
          await peerRef.current.setRemoteDescription(changed.answer_sdp);
          remoteDescriptionSet.current = true;
          setCall(changed);
        }
        if (callRef.current?.id === changed.id && ['declined', 'ended', 'missed'].includes(changed.status)) cleanup();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_ice_candidates' }, async ({ new: value }) => {
        const candidate = value as { call_id: string; user_id: string; candidate: RTCIceCandidateInit };
        if (candidate.call_id === callRef.current?.id && candidate.user_id !== userId && peerRef.current) {
          try { await peerRef.current.addIceCandidate(candidate.candidate); } catch { /* Candidate may precede remote SDP; later candidates continue. */ }
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [cleanup, userId]);

  useEffect(() => () => {
    peerRef.current?.close();
    localStream?.getTracks().forEach((track) => track.stop());
  }, [localStream]);

  return { call, incomingCall, localStream, remoteStream, error, startCall, acceptCall, declineCall, endCall };
}
