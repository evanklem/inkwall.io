inkwall.io - Architecture Overview


Goal: a multi-page mural (discrete pages/tiles), everyone draws vector strokes, contributions are live and durable, anonymous presence is visible, and contributions are rate-limited (e.g., 1 contribution per hour per page). No custom WebSocket server to maintain, use Supabase realtime and Edge functions to handle broadcasts and server-side enforcement.




Core components (top → bottom):


* Client (React + react-konva) — drawing UI, smoothing, optimistic rendering, upload to server.


* Network layer (Supabase Realtime WebSocket + HTTP Edge RPCs) — push/pull of events and secure atomic inserts.


* Database (Postgres on Supabase) — canonical event store (strokes, sessions, pages).


* Edge Functions (Supabase Functions) — atomic rate-limited inserts and moderation endpoints.


* Storage & CDN (Supabase Storage + Vercel/Cloudflare CDN) — page snapshots (fast initial load).


* Observability (basic metrics / logging) — simple dashboards + error reporting.


(Why Supabase + Edge functions? You get Postgres durability + a hosted realtime stream so you don’t run a WebSocket server yourself; Edge functions let you run small server logic (rate-limiting, auth checks) close to users.) 


Component-by-component (detailed)


1) Client - React + react-konva (Canvas abstraction)


Responsibilities


* Drawing tools (pen, brush, zero eraser to simulate true graffiti).


* Convert pointer input → compressed stroke objects (smoothed point arrays or paths).


* Optimistic rendering: render stroke locally immediately, send to server; if server rejects, visually mark/rollback.


* Subscribe to realtime stroke events and render incremental deltas.


* Presence UI: show online contributors’ cursors + colors.


* Export / Snapshot: allow user to download PNG or request server snapshot upload.


Why react-konva


* Declarative canvas drawing and good React integration; has examples for free-drawing and vector strokes. It handles layers, transforms (zoom/pan), touch support, and is easy to integrate into a modern React app. 


Key implementation notes (client)


* Stroke payload shape (compact):


{
  "page_id":"page_03",
  "session_id":"uuid",
  "color":"#ff0066",
  "width":4,
  "points":[[x1,y1],[x2,y2],...],
  "tool":"pen",
  "created_at":"2025-11-01T12:00:00Z"
}




* Use localStorage session_id (crypto.randomUUID()) to represent anonymous identity. Do upsert on sessions for heartbeat.


* Use request batching: group many point events into one stroke (client-side smoothing), do not broadcast every single pointer move as a separate DB row. This dramatically reduces event volume.


* Use throttling/debounce on broadcast (e.g., send finished stroke or at most one in-flight every 50–200ms for long strokes).


2) Network / Realtime - Supabase Realtime (Postgres changes over WebSocket)


Responsibilities


* Broadcast new strokes to all clients subscribed to a page.


* Broadcast session presence updates (session upsert / heartbeat).


* Allow client subscriptions to filters like strokes:page_id=eq.page_03.


How it fits


* Client connects via the Supabase JS client; Realtime subscription streams Postgres INSERTs/UPDATEs over WebSocket so clients instantly receive new strokes without you managing the socket server. Supabase creates helper functions/triggers to broadcast DB changes. 


Important patterns


* Snapshot + delta: on initial page load, fetch the latest PNG snapshot from Storage (fast, CDN-cached) then subscribe to strokes since that snapshot timestamp and replay deltas. This avoids replaying millions of rows on load and is exactly how large shared canvases handle scale. (r/Place used snapshots + CDN to reduce read load.) 




* Subscription scope: subscribe only to the current page (filter by page_id) and optionally to spatial partitions (if you later split a page into tiles to reduce bandwidth).


3) Persistence - Postgres schema (source of truth)


Tables (minimal):


* pages(id, width, height, created_at) — board segments / sections.


* sessions(session_id UUID PK, display_name, color, current_page, last_seen) — ephemeral presence.


* strokes(id serial, page_id, session_id, color, width, points jsonb, created_at) — each stroke as a vector JSON payload. Index on (page_id, created_at) and (session_id, created_at) for efficient queries.


Why events (strokes) not pixels


* Vector strokes are compact, zoomable, exportable as SVG, and much friendlier for a design-focused mural than raw pixels.


Durability & snapshots


* Periodically (e.g., every N minutes or after N strokes) render the canvas server-side or client-side to a PNG and store in Supabase Storage. Serve snapshots via CDN for fast initial load; store the snapshot timestamp so clients only replay strokes after that time. This reduces load on the DB when many new clients join. (Technique used by r/Place.) 


4) Serverless business logic - Supabase Edge Functions / Postgres RPC


Responsibilities


* Enforce server-side rate limits / cooldowns (one contribution per hour per page).


* Provide authenticated RPC for insertion (atomic check → insert).


* Accept moderation actions (delete stroke, flag stroke).


* Export/flatten page into a canonical snapshot (optional).


Implementation patterns


Two approaches:


* Postgres RPC function (PL/pgSQL) that atomically checks last stroke time for a session & page and inserts if permitted. This keeps logic entirely in the DB and is atomic.


* Edge Function that validates JWT/session, optionally uses Redis for high-throughput token bucket checks, then calls DB RPC. Supabase docs and examples show Edge Functions are a good place for rate-limiting logic (and can be throttled at the gateway). 
Why RPC/Edge functions?


* Prevents client-side cheating: clients must call an endpoint that enforces business rules. You avoid exposing an open insert endpoint that a malicious client can spam. Supabase supports running Edge Functions close to users and applying auth/policies there. 


5) Presence, heartbeats & “who’s online”


Pattern


* On connect, client upserts into sessions (session_id, display_name, color, current_page, last_seen).


* Client sends heartbeat every 20–30s to update last_seen.


* Clients subscribe to sessions table where current_page = X (or to a filtered presence channel). Display any session with last_seen within the last N seconds as online.


* Expire sessions server-side with a cron job or when last_seen < now() - INTERVAL '60s'.


Why this instead of Auth


* Anonymous presence gives low friction while enabling “who’s here” UX. If abuse becomes severe you can add optional OAuth login later.


6) Managing Stroke Accumulation & Performance


Problem: Each stroke is a vector path; large histories (tens of thousands of paths) slow down Konva/HTML canvas because all paths are redrawn every update.


Solutions:


* Snapshot flattening: Every 200–500 strokes or few minutes, flatten visible canvas into a PNG. Clear in-memory strokes; new strokes layer above snapshot.


* Delta rendering: Clients fetch only strokes created after snapshot timestamp; subscribe to realtime inserts for live updates.


* Render pipeline separation: Base layer (snapshot PNG) + live strokes layer (recent strokes). Occasionally merge layers as needed.


* Compression / downsampling: Simplify each stroke’s points (e.g., Douglas-Peucker) to reduce vertex count without visible loss.


* Optional server-side prerendering: Edge Function or serverless worker generates composite PNG from recent strokes, reducing client load.


7) Export, snapshots, playback & time-lapse


Snapshot production: after a threshold (time or strokes), produce a PNG snapshot and upload to Storage; store snapshot timestamp in pages. Serve these PNGs through Vercel/Cloudflare CDN for fast initial loads. 
Reddit Inc


Playback / time-lapse: to show evolution, query strokes for a page and replay them in order on the client with a speed control. Small pages replay quickly; for long histories, use sampled playback or precomputed condensed events.


8) Deployment & hosting


Frontend: host on Vercel (Hobby free) or Cloudflare Pages, both provide free static hosting with global CDN and HTTPS. Vercel is particularly easy for React/Next apps and automatic CI/CD from GitHub. 


Backend: Supabase hosted project (free tier available) provides Postgres, Realtime, Edge Functions, and Storage. No extra server required. 


End-to-end sequences (two key flows)


A - Draw and broadcast (preferred safe flow)


* User draws stroke → client renders locally immediately (optimistic).


* Client calls Edge Function POST /insertStroke with stroke payload (session_id from localStorage).


* Edge Function validates cooldown by calling DB RPC or Redis token & then inserts stroke row into strokes.


* Insert triggers Supabase Realtime broadcast (WAL trigger) which sends INSERT over WebSocket to all subscribed clients. 


* Other clients receive payload and render the stroke.


* Edge Function returns success to origin; if rejected, client shows a cooldown notice and optionally withdraws/marks stroke.


B - New client joins a page (fast load)


* Client requests page metadata: fetch latest snapshot URL + snapshot timestamp.


* Client downloads snapshot PNG from Storage (served via CDN) and renders as background. 


* Client subscribes to strokes for page_id and requests all strokes with created_at > snapshot_timestamp to catch up. Replay them in order.


* Client begins listening to realtime inserts.


Data model


pages(id text PK, width int, height int, snapshot_url text, snapshot_ts timestamptz)


sessions(session_id uuid PK, display_name text, color text, current_page text, last_seen timestamptz)


strokes(id bigserial PK, page_id text, session_id uuid, color text, width int, points jsonb, created_at timestamptz)
Indexes: (page_id, created_at).


Rate-limiting and anti-abuse 


Server-side atomic cooldown: enforced via DB RPC or Edge Function. This is essential, client-side checks are insufficient. Supabase docs and examples show Edge Functions and Redis-based counters are common patterns for rate limiting. 


Throttle & batch: send completed strokes only (not every pointer move), batch long strokes into multiple segments if needed.


CDN caching for static snapshots: reduces read load and prevents everyone from fetching full state directly from DB — r/Place used CDN caching to reduce read pressure. 
Reddit Inc


Scaling roadmap (if this becomes popular)


Short term (dev/early): Supabase free tier + Vercel - snapshot+delta model, single DB instance. Optimize client batching.


Medium term: add sharding by page (split very large pages into tiles), partition strokes table by page or time. Use Redis for fast ephemeral counters or presence if latency needs increase.


Large scale: use edge replication & a CDN for snapshots, push delta streams via regional pubsub (e.g., use a managed pub/sub or Redis Streams), and consider a dedicated real-time service (Ably/Pusher) if you need guaranteed delivery SLAs. For extremely heavy pixel-like loads, r/Place used optimized bitfields & caching — but you won’t need that for vector strokes. 


Security, cost & tradeoffs


Cost: This stack can be run fully free for prototyping (Supabase free tier + Vercel Hobby). Storage, DB size, and Edge function invocations are the primary cost drivers once traffic grows. Monitor usage dashboards. 


Data privacy: Anonymous sessions are simple, but if you add OAuth later keep privacy policies; avoid storing PII unless necessary.


Complexity tradeoff: Using Supabase removes the need to operate a WebSocket server but ties you to vendor limits. If you later outgrow the free tier, you can export Postgres and move to self-hosted options.




Developer checklist


Supabase project + create schema (pages, sessions, strokes).


Frontend scaffold (React + react-konva) with local free drawing, zoom/pan, and optimistic render.


Edge Function / RPC that enforces 1-hour cooldown and inserts strokes atomically.


Subscriptions for strokes and sessions on the client to render live updates and presence.


Snapshot export to Storage and snapshot-based page bootstrap (snapshot + replay deltas).


Basic admin UI for a simple rate-limit dashboard.

