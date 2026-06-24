# 3SChat

3SChat is a database-backed, real-time messaging app built with Next.js 16 and Supabase. It supports email verification codes, direct messages, private image uploads, recorded voice messages, emoji insertion/reactions, profile editing, and a database-enforced one-active-device policy.

There is no mock mode and Supabase remains the source of truth. Supabase Auth retains the browser's authentication token, while IndexedDB stores only an offline outbox until queued messages reach the database; chats, profiles, messages, reactions, media metadata, and active-session state live in Supabase.

## Required Supabase setup

1. Create a Supabase project and run [`supabase.sql`](./supabase.sql) in its SQL editor. Re-run the file when upgrading an older 3SChat database; it is written as a migration and preserves existing rows.
2. In **Authentication → Providers**, enable Email. Phone/SMS and Twilio are not required.
3. In **Authentication → Email Templates → Magic Link**, make the message contain the eight-digit token. For example:

   ```html
   <h2>Your 3SChat verification code</h2>
   <p>Enter this code in 3SChat:</p>
   <p style="font-size: 28px; letter-spacing: 6px"><strong>{{ .Token }}</strong></p>
   <p>This code expires shortly. If you did not request it, ignore this email.</p>
   ```

4. For production delivery, configure a custom SMTP provider under **Project Settings → Authentication → SMTP**. Supabase's default sender is intended for testing and is rate-limited.
5. Add your deployment URL under **Authentication → URL Configuration**.
6. Copy `.env.local.example` to `.env.local` and fill in the project's URL and publishable/anon key.

## Create the first administrator

There is deliberately no default admin password. After the intended administrator has signed in once, run this in the Supabase SQL editor with their real phone number:

```sql
update public.profiles
set role = 'admin'
where phone_number = '+254700000000';
```

Sign out and back in. The shield button in the chat rail opens `/admin`. Further role changes, suspensions, report reviews, and audit records are handled from that protected dashboard. Never expose an admin-promotion control on public signup.

The `chat-media` bucket is private. Clients receive one-hour signed URLs and storage RLS checks chat membership before allowing upload or download. The 15 MB limit and accepted image/audio MIME types can be adjusted in `supabase.sql`.

## Calls and push infrastructure

WebRTC calls use Supabase for authenticated signaling. The included public STUN server is enough for local testing, but production calls require a TURN service. Configure `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USERNAME`, and short-lived `NEXT_PUBLIC_TURN_CREDENTIAL` values.

Push notifications require the server-only Supabase service-role key and VAPID keys from `.env.local.example`. Generate VAPID keys with:

```bash
npx web-push generate-vapid-keys
```

Never prefix the service-role key or VAPID private key with `NEXT_PUBLIC_`.

## Message encryption

Chats can enable experimental shared-secret AES-256-GCM encryption. PBKDF2 derives the key in the browser and the secret is kept only in memory; the database stores ciphertext, IV, and salt. Participants must exchange the secret outside 3SChat. This protects message bodies from database readers, but it is **not a Signal Protocol implementation**: it has no identity safety numbers, automatic key exchange, forward secrecy, or recovery. Do not market this mode as audited end-to-end encryption.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`. Microphone capture works on localhost and on HTTPS deployments; browsers block it on insecure remote origins.

## Verification

```bash
npm run lint
npm run build
```

## Security model

Each Supabase access token includes an immutable `session_id`. After email verification, `activate_session()` atomically records that ID for the account. Every profile, chat, message, reaction, and media policy calls `is_active_session()`, so signing in elsewhere immediately prevents the older session from reading or writing data. Realtime also tells the older UI to sign out.

This app protects transport, storage access, and database authorization, but it does not claim end-to-end encryption: Supabase stores message content on the server. End-to-end encryption would require a separate, audited client-side key-management protocol.
