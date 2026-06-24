# 3SChat

3SChat is a database-backed, real-time messaging app built with Next.js 16 and Supabase. It supports Google OAuth, email verification codes, direct messages, private image uploads, recorded voice messages, emoji insertion/reactions, profile editing, and a database-enforced one-active-device policy.

There is no mock mode and Supabase remains the source of truth. Supabase Auth retains the browser's authentication token, while IndexedDB stores only an offline outbox until queued messages reach the database; chats, profiles, messages, reactions, media metadata, and active-session state live in Supabase.

## Required Supabase setup

1. Create a Supabase project and run [`supabase.sql`](./supabase.sql) in its SQL editor. Re-run the file when upgrading an older 3SChat database; it is written as a migration and preserves existing rows.
2. In **Authentication → Providers**, enable Email. Phone/SMS and Twilio are not required.
3. Configure Google OAuth (the recommended free login method):

   - In Google Cloud Console, create an **OAuth 2.0 Client ID** with application type **Web application**.
   - Add the Supabase callback shown on the Google provider page as an authorized redirect URI. It normally looks like `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.
   - In **Supabase → Authentication → Providers → Google**, enable Google and paste the Google Client ID and Client Secret.
   - In **Supabase → Authentication → URL Configuration**, set the Site URL to the production Vercel URL and add these redirect URLs:
     - `http://localhost:3000/login`
     - `https://YOUR_VERCEL_DOMAIN/login`
   - Add each Vercel preview URL only if OAuth must work on preview deployments. Production should use a stable custom or Vercel domain.

   The client uses `window.location.origin + '/login'`, so the same code automatically returns to localhost during development and the active Vercel domain after deployment. Google OAuth secrets belong in Google/Supabase dashboards, not `.env.local`.
   See the [Supabase Google OAuth guide](https://supabase.com/docs/guides/auth/social-login/auth-google) for the current Google Cloud screenshots and consent-screen requirements.

4. In **Authentication → Email Templates → Magic Link**, keep the existing message containing the eight-digit token. For example:

   ```html
   <h2>Your 3SChat verification code</h2>
   <p>Enter this code in 3SChat:</p>
   <p style="font-size: 28px; letter-spacing: 6px"><strong>{{ .Token }}</strong></p>
   <p>This code expires shortly. If you did not request it, ignore this email.</p>
   ```

5. Configure a custom SMTP provider under **Authentication → SMTP Settings** before testing email OTP with normal user addresses. Supabase's default test mailer refuses delivery to addresses that are not members of the project's organization team. After enabling custom SMTP, review **Authentication → Rate Limits**; Supabase initially applies a 30-email-per-hour limit to custom SMTP.

   If the app reports `Error sending confirmation email`, open **Logs → Auth** in the Supabase dashboard. The usual causes are the default-mailer recipient restriction, invalid SMTP credentials/sender details, an unverified sender domain, or an email rate limit.
6. Copy `.env.local.example` to `.env.local` and fill in the project's URL and publishable/anon key.

## Create the first administrator

There is deliberately no default admin password. After the intended administrator has signed in once, run this in the Supabase SQL editor with their real phone number:

```sql
update public.profiles
set role = 'admin'
where phone_number = '+254700000000';
```

Sign out and back in. The shield button in the chat rail opens `/admin`. Further role changes, suspensions, report reviews, and audit records are handled from that protected dashboard. Never expose an admin-promotion control on public signup.

For a Google-only administrator without a phone number, promote by verified email instead:

```sql
update public.profiles as profile
set role = 'admin'
from auth.users as auth_user
where profile.id = auth_user.id
  and lower(auth_user.email) = lower('admin@example.com');
```

The `chat-media` bucket is private. Clients receive one-hour signed URLs and storage RLS checks chat membership before allowing upload or download. Images and voice notes are limited to 5 MB, and large non-GIF images are resized in the browser before upload. Video and general file upload are intentionally disabled for this free-tier MVP.

## Free-tier operating guide (about 300 users)

The chat list uses a compact database summary function and each conversation initially loads only the latest 30 messages. Older messages load in 30-message pages when the user scrolls upward or presses **Load older messages**. Realtime is reserved for messages, reactions, pins, receipts, typing, presence, session replacement, status updates while their panel is open, and existing call signaling.

Check these dashboards once a week and record the current usage so growth is visible before a quota is reached:

- **Supabase Database:** database size, message growth, and slow query/index recommendations.
- **Supabase Storage:** total `chat-media` and `status-media` size.
- **Supabase Bandwidth/Egress:** unexpected spikes, especially signed media downloads.
- **Supabase Realtime:** peak concurrent connections and message/event count.
- **Supabase Auth:** total monthly active users and unusual OTP request failures.
- **Resend:** sent email count, bounces, complaints, and the current plan quota.
- **Vercel:** function invocations, bandwidth, and failed `/api/push/*` requests.

Free-tier quotas can change, so use the provider dashboards as the source of truth. If usage grows too quickly, reduce media retention or sizes before adding infrastructure.

### Expired status cleanup

The app and RLS query exclude statuses after `expires_at`, which defaults to 24 hours. Supabase Storage does not automatically delete their private image objects. Until a scheduled cleanup function is justified, clean them during the weekly check:

1. Run `select id, media_path from public.status_updates where expires_at <= now() and media_path is not null;` and keep the result.
2. Delete those paths from the private `status-media` bucket using the Supabase Storage dashboard.
3. Run `delete from public.status_updates where expires_at <= now();` only after the matching objects are removed.

Do not delete the database rows first, because their `media_path` values are needed to locate the expired objects.

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
