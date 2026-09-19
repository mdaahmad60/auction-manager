# GitHub + Cloudflare + Supabase deployment

Cloudflare Workers serves the static app and the overview WebSocket endpoint. A SQLite Durable Object holds each tournament's latest public overview and distributes updates. Supabase retains organizer accounts and private workspaces. GitHub stores source and runs validation/deployment. Vercel is not required.

The controller must stay open to publish new updates. Viewers reconnect automatically and receive the last snapshot. An offline controller is labeled in the overview. The standard OBS overlay uses PeerJS; the separate “Overlay via Internet” link and the public overview use Cloudflare.

## 1. Supabase

1. Create a project (or keep your existing project).
2. For a new database, execute `supabase/migrations/202609130001_private_workspaces.sql` in the Supabase SQL editor. Do not rerun it if already applied.
3. Execute `supabase/migrations/202609190001_live_room_ownership.sql` once. This adds the server-managed room registry and preserves existing overview and Internet-overlay links. If a duplicate room ownership claim causes it to fail, the transaction rolls back; resolve the conflicting records before retrying.
4. Copy the project URL and publishable key. A legacy anon key also works. Do not use a secret/service-role key.
5. After deployment, set Authentication → URL Configuration → Site URL to your Cloudflare HTTPS URL. Add that URL and its confirmation/recovery query variants to the allowed redirect URLs. For development also allow `http://localhost:8787/**`.

## Upgrading an already-live installation

1. Schedule a short controller pause and apply `202609190001_live_room_ownership.sql` in the Supabase SQL editor **before deploying this code**. Do not rerun the initial workspace migration.
2. Deploy the matching Worker and browser build together using the existing workflow. Reopen controller pages after deployment. Publisher connections authorized by the old ownership check will reconnect and reauthenticate.
3. Verify the existing overview and Internet-overlay links in a signed-out browser, then resume the auction.

Room ownership is now checked against `auction_live_rooms`, not editable workspace peer IDs. Authenticated users can read their own registry rows, but cannot insert, modify, or delete them. The `get_auction_live_room` RPC generates new IDs on the server; the `can_publish_auction_room` RPC checks registered ownership and that the tournament still exists. These functions require the migration. The new Worker fails closed if it has not been applied.

The migration retains links present when it runs. Avoid creating new tournaments between migration and deployment: an old controller can generate an unregistered link that the new version must replace. Conflicting historical room claims need an administrator's review; the migration deliberately refuses to pick an owner arbitrarily.

## 2. First deployment from your computer

Install Node.js 22 and npm. In the project directory:

```sh
npm ci
cp .env.example .env.local
cp .dev.vars.example .dev.vars
```

Fill both files with your Supabase URL and publishable key. `.env.local` configures the browser build; `.dev.vars` configures the local Worker. Both are ignored by Git.

```sh
npx wrangler login
npm run build:cloudflare
npx wrangler deploy
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
```

Paste the corresponding value at each secret prompt. The initial deployment provisions the Worker; live publishing works once both runtime values are set. Keep the generated Durable Object migration and binding names in `wrangler.jsonc`. Change `name` before first deployment if you want a different Worker name.

Open the HTTPS URL printed by Wrangler, configure Supabase redirects, sign in, create/load a tournament, and copy its Overview link. In account mode, the server allocates the permanent room ID before the link is shown or the publisher connects.

For local Cloudflare testing:

```sh
npm run dev:cloudflare
```

This uses your configured Supabase project. Use a separate test project/account when testing mutations. Plain `npm run dev` retains the legacy transport; use the Cloudflare command to exercise the new backend.

## 3. GitHub deployment

Upload the project to your repository, excluding ignored files. Add these repository Actions settings:

| Setting type | Name | Value |
|---|---|---|
| Variable | `SUPABASE_URL` | Project HTTPS URL |
| Variable | `SUPABASE_PUBLISHABLE_KEY` | Publishable or anon key |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| Secret | `CLOUDFLARE_API_TOKEN` | Token with Workers Scripts Edit for this account; add Account Settings Read if required by your account setup |

Complete the first deployment above before using the workflow. In GitHub Actions select **Deploy Cloudflare → Run workflow**. It tests, builds, sets Worker runtime configuration and deploys. Deployment is manual by default; pushing code runs validation only.

Do not upload `.env.local`, `.dev.vars`, `node_modules`, `.wrangler`, or `dist`. GitHub builds `dist` from source. No repository or deployment has been created by preparing these files.

## Live behavior and access

- Viewers connect to `wss://YOUR-HOST/api/live/auction-ROOM-ID` on the same origin. The existing overview URL contains the room ID.
- The controller authenticates in the first WebSocket message, never in the URL. The server validates the token with Supabase and checks the server-managed room registry and active tournament through row-level security.
- Only one controller publishes to a room at once. Opening another controller stops the old publisher; reload the old page to take over again.
- Viewer sockets cannot publish changes. Anyone with an overview link can read the spectator snapshot. Only select player information intended for that audience.
- The latest snapshot remains after the controller closes. Deleting a tournament through the Cloudflare app removes both its overview and Internet-overlay snapshots and closes their connections before deleting its Supabase workspace data. If one room fails to delete, the tournament remains available for retry; already deleted rooms accept repeated cleanup requests. Direct database edits bypass this cleanup.
- Images should use URLs. Messages have a 1 MB limit; oversized snapshots produce a controller warning. The room permits up to 1,100 sockets as an application limit, not a performance guarantee.
- Ordinary bid updates are compact; roster/directory changes send a full snapshot. Hibernation and automatic ping/pong avoid keeping idle sockets billed as continuously running JavaScript.
- API routes require same-origin browser connections. A separate ChatGPT Sites frontend is not enabled in this configuration.

## Event readiness

Run `npm test`, then test two separate browsers: controller and overview. Verify selection, selected metadata, increments, sold/unsold, reconnect, and organizer sign-out. Confirm a different account cannot publish to another account's room.

The included `scripts/load-overview.mjs` can open spectator connections against a test room:

```sh
node scripts/load-overview.mjs 'wss://YOUR-HOST/api/live/auction-ROOM-ID' 500 60
```

Run only against your own test deployment. Keep the controller connected and change a bid during the test. This measures connections and received updates, not a full mobile browser/rendering load. Check Cloudflare usage and errors before relying on it for an event. Paid Workers starts at $5/month with usage-based charges; free-tier quotas also apply to Durable Objects. Capacity and final cost need measurement.

References: https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/ and https://developers.cloudflare.com/workers/platform/pricing/

## Regression checks

`npm test` includes in-memory PostgreSQL tests for migration/backfill, RLS, forged ownership claims, server allocation and deleted tournaments, plus browser regressions for public Internet-overlay access, result transitions and both-room cleanup.

After `npm run build:cloudflare`, run `npm run test:cloudflare` to exercise 500 local WebSocket viewers against the bundled Worker with Supabase mocked. This checks transport behavior, not production capacity or a live Supabase deployment.
