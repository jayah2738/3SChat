# 3SChat

3SChat is a database-backed, real-time messaging app built with Next.js 16 and Supabase. It supports email verification codes, direct messages, private image uploads, recorded voice messages, emoji insertion/reactions, profile editing, and a database-enforced one-active-device policy.

There is no mock mode and no application data is stored in `localStorage`. Supabase Auth retains the browser's authentication token so a signed-in session can survive refreshes; chats, profiles, messages, reactions, media metadata, and active-session state live in Supabase.

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

The `chat-media` bucket is private. Clients receive one-hour signed URLs and storage RLS checks chat membership before allowing upload or download. The 15 MB limit and accepted image/audio MIME types can be adjusted in `supabase.sql`.

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
