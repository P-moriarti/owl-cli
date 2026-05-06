/**
 * Curated Supabase knowledge base.
 * Hand-picked gotchas, patterns, and best practices covering the most common
 * issues developers encounter. Injected into every system prompt so Owl gives
 * accurate, Supabase-specific answers without needing to retrieve external docs.
 */

export const SUPABASE_KNOWLEDGE = `
## SUPABASE KNOWLEDGE BASE

### ROW LEVEL SECURITY (RLS)

**Critical: RLS is disabled by default**
New tables have RLS disabled. Any authenticated or anon user can read/write everything
until you run \`ALTER TABLE <name> ENABLE ROW LEVEL SECURITY\`. Always enable RLS on
tables that contain user data.

**No policies = no access (when RLS is ON)**
A table with RLS enabled but zero policies blocks ALL access — even for the table owner
via the anon/service keys. You must create explicit policies or use the service role key.

**auth.uid() vs request.jwt.claim**
Use \`auth.uid()\` (not \`auth.jwt() ->> 'sub'\`) — it is null-safe and works correctly
with all Supabase auth providers. Always write policies as:
\`\`\`sql
using (auth.uid() = user_id)
\`\`\`

**Service role bypasses RLS**
Queries made with \`SUPABASE_SERVICE_ROLE_KEY\` skip all RLS policies entirely.
Never expose this key to the frontend. Use it only in trusted server-side code.

**Recursive policy pitfall**
A policy that queries the same table it protects can cause infinite recursion.
Avoid \`select from profiles where id = auth.uid()\` inside a profiles policy.
Instead, read from \`auth.users\` or use a security definer function.

**Policy for INSERT needs WITH CHECK, not USING**
\`USING\` filters rows being read. \`WITH CHECK\` validates rows being written.
For INSERT you only need \`with check\`; for UPDATE you usually need both:
\`\`\`sql
create policy "users update own row" on profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);
\`\`\`

**Permissive vs Restrictive policies**
All permissive policies are OR'd together. A restrictive policy uses AND.
Default is permissive. Use \`as restrictive\` only when you need a hard block
that no permissive policy can override (e.g. soft-delete guard).

---

### AUTHENTICATION

**Email confirmations are ON by default**
New signups receive a confirmation email and cannot sign in until confirmed.
For development, disable this in Auth → Settings → "Enable email confirmations".

**Magic link vs password**
Magic link tokens expire after 1 hour by default. If users report "link expired",
check Auth → URL Configuration — the Site URL must match your deployed domain exactly,
including the protocol and trailing slash.

**OAuth redirect URLs**
Must be whitelisted in Auth → URL Configuration → Redirect URLs.
Common mistake: adding \`http://localhost:3000\` but forgetting
\`http://localhost:3000/**\` (with wildcard) for deep links.

**JWT expiry**
Default JWT expiry is 1 hour. The client SDK auto-refreshes using the refresh token.
If you are using the JWT in a custom backend, validate expiry and handle 401 → refresh.

**User deletion**
Deleting from \`auth.users\` cascades to anything with
\`references auth.users on delete cascade\`. Make sure your \`profiles\` table
has that constraint or you will get orphaned rows.

**anon key is public — that is fine**
The anon key is safe to expose in frontend code. It only grants the permissions
your RLS policies allow for the \`anon\` role. Never expose the service role key.

---

### SCHEMA & MIGRATIONS

**Always use UUIDs as primary keys**
\`id uuid primary key default gen_random_uuid()\` is the Supabase convention.
It avoids sequential ID enumeration and works across replicas.

**timestamptz, not timestamp**
Store all timestamps as \`timestamptz\` (timestamp with time zone).
\`timestamp\` stores no timezone info and causes subtle bugs with daylight saving.

**Soft deletes**
Add \`deleted_at timestamptz\` and filter with \`where deleted_at is null\`.
Combine with a restrictive RLS policy to prevent users from reading deleted rows.

**Indexes**
Foreign key columns are NOT automatically indexed in PostgreSQL.
Always add: \`create index on orders (user_id);\`
Composite indexes: column order matters — put the most selective column first.
Use \`pg_stat_user_indexes\` and \`pg_stat_user_tables\` to find unused indexes.

**generated always as (expr) stored**
Use stored generated columns for denormalised values you query often
(e.g. full_name generated from first_name + last_name). Cannot be updated manually.

**Avoid \`serial\` / \`bigserial\`**
Use \`identity\` columns or \`gen_random_uuid()\` instead.
\`serial\` creates a sequence that is not transactionally safe for high-concurrency inserts.

---

### REAL-TIME

**Enable replication per table**
Real-time is opt-in per table. Run:
\`\`\`sql
alter publication supabase_realtime add table your_table;
\`\`\`
Without this, \`channel.on('postgres_changes', ...)\` will never fire.

**RLS applies to real-time**
Real-time respects RLS when \`REPLICA IDENTITY\` is set. For UPDATE/DELETE events,
set \`alter table your_table replica identity full\` so the old row values are
available and RLS can evaluate them correctly.

**Filter on the server, not the client**
Use \`.filter('user_id', 'eq', userId)\` in the channel subscription to limit
bandwidth. Without filters, every matching row change is sent to every subscriber.

---

### STORAGE

**Bucket policies are separate from RLS**
Storage uses its own policy system under \`storage.objects\`.
Creating a bucket does not automatically secure it. Write explicit policies:
\`\`\`sql
create policy "users read own files" on storage.objects
  for select using (auth.uid() = owner);
\`\`\`

**Public buckets**
A public bucket exposes ALL objects to anyone with the URL — no auth needed.
Use public buckets only for truly public assets (avatars, logos).
Keep user documents in private buckets with signed URLs.

**Signed URLs expire**
\`createSignedUrl\` generates a URL valid for N seconds. Cache them client-side
and refresh before they expire. Default is 60 seconds — increase for downloads.

---

### EDGE FUNCTIONS

**Cold starts**
Deno-based Edge Functions have cold starts (~300–600 ms). For latency-sensitive
endpoints, use the \`--no-verify-jwt\` flag only in development; keep JWT verification
in production to protect the function.

**Environment variables**
Set secrets with \`supabase secrets set KEY=value\`, not via \`.env\` files.
Access them in code via \`Deno.env.get('KEY')\`.

**CORS**
Edge Functions do not add CORS headers automatically. Return the correct headers
or use the \`corsHeaders\` helper pattern from the official Supabase examples.

---

### PERFORMANCE

**Use \`explain analyze\` in the SQL editor**
Run \`explain (analyze, buffers) select ...\` to see actual execution plans.
Look for Seq Scan on large tables — that is a missing index.

**Connection pooling**
Use the pooler connection string (port 6543) in serverless/edge environments.
Direct connections (port 5432) are for long-running servers only. Supabase limits
direct connections based on your plan.

**select only what you need**
\`select *\` from a table with jsonb columns or many columns wastes bandwidth and
disables index-only scans. Explicitly list columns in every query.

**Partial indexes**
For soft-delete patterns, a partial index on active rows is much smaller and faster:
\`\`\`sql
create index active_orders_user_id on orders (user_id)
  where deleted_at is null;
\`\`\`
`
