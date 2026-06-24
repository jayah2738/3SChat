import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const token = authorization.slice(7);
  const body = await request.json() as { subscription?: PushSubscriptionJSON };
  if (!body.subscription?.endpoint) return Response.json({ error: 'Invalid subscription' }, { status: 400 });

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  });
  const { data: { user }, error: userError } = await client.auth.getUser(token);
  if (userError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { error } = await client.from('push_subscriptions').upsert({ user_id: user.id, endpoint: body.subscription.endpoint, subscription: body.subscription, updated_at: new Date().toISOString() }, { onConflict: 'endpoint' });
  return error ? Response.json({ error: error.message }, { status: 400 }) : Response.json({ ok: true });
}
