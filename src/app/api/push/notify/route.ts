import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!serviceKey || !publicKey || !privateKey) return Response.json({ error: 'Push is not configured' }, { status: 503 });
  const { chatId, title = '3SChat', body = 'You have a new message' } = await request.json() as { chatId?: string; title?: string; body?: string };
  if (!chatId) return Response.json({ error: 'Missing chat' }, { status: 400 });

  const token = authorization.slice(7);
  const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser(token);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: participants, error: participantError } = await userClient.from('chat_participants').select('user_id').eq('chat_id', chatId);
  if (participantError || !participants?.some((entry) => entry.user_id === user.id)) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const recipients = participants.filter((entry) => entry.user_id !== user.id).map((entry) => entry.user_id);
  if (!recipients.length) return Response.json({ sent: 0 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } });
  const { data: subscriptions } = await admin.from('push_subscriptions').select('id, subscription').in('user_id', recipients);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', publicKey, privateKey);
  let sent = 0;
  await Promise.all((subscriptions || []).map(async (entry) => {
    try {
      await webpush.sendNotification(entry.subscription as webpush.PushSubscription, JSON.stringify({ title, body, url: '/chat' }));
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', entry.id);
    }
  }));
  return Response.json({ sent });
}
