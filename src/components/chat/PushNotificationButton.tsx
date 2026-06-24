'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function PushNotificationButton() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !publicKey) return;
    const timeout = setTimeout(() => {
      setSupported(true);
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(async (registration) => setSubscribed(!!await registration.pushManager.getSubscription()));
    }, 0);
    return () => clearTimeout(timeout);
  }, [publicKey]);

  const toggle = async () => {
    if (!publicKey) return;
    setBusy(true);
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe();
      setSubscribed(false);
    } else {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ subscription: subscription.toJSON() }) });
        setSubscribed(response.ok);
      }
    }
    setBusy(false);
  };

  if (!supported) return <p className="text-[10px] text-gray-500">Push notifications require VAPID configuration and a supported browser.</p>;
  return <button type="button" disabled={busy} onClick={() => void toggle()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 py-2.5 text-xs text-gray-300 hover:bg-white/5">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : subscribed ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}{subscribed ? 'Disable push notifications' : 'Enable push notifications'}</button>;
}
