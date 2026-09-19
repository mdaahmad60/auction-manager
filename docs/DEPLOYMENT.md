# Create and deploy your projects

The files are ready for new projects. No hosted resources have been created yet.

## 1. Supabase

1. Create a project in your Supabase organization. Keep the database password private.
2. In SQL Editor, run `supabase/migrations/202609130001_private_workspaces.sql` once. This creates the private workspace table, ownership policies, and versioned save function.
3. In Authentication, enable email/password signup and email confirmation. Set the password minimum to eight characters or higher.
4. Copy the project URL and **publishable key** from the project settings. A legacy `anon` key also works. Never use a secret or `service_role` key in this app.
5. Under Authentication → URL Configuration, set Site URL to your final Vercel production origin. Add these redirect URLs, replacing the example domain:
   - `http://localhost:3000/?auth=confirmed`
   - `http://localhost:3000/?auth=recovery`
   - `https://YOUR-PROJECT.vercel.app/?auth=confirmed`
   - `https://YOUR-PROJECT.vercel.app/?auth=recovery`
6. Configure your SMTP provider for production confirmation and password-reset emails. Supabase's default email service is restricted and is intended for testing. See [password authentication setup](https://supabase.com/docs/guides/auth/passwords).

Database access is scoped by the signed-in user's ID using [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security). Display links do not grant access to the database. Accounts have separate tournament workspaces; this version does not provide shared organization membership.

## 2. Local development

Install Node 22, then:

```sh
cp .env.example .env.local
# Edit .env.local with your project URL and publishable key.
npm install
npm test
npm run dev
```

Open `http://localhost:3000`. Create an account, follow the email confirmation link, and log in. The SQL migration must be applied before the workspace can load. `.env.local` is ignored by Git. Browser configuration contains only the public project URL and public key.

## 3. GitHub

Create a new private repository named `auction-manager` on GitHub without an initial README. From this project directory, initialize Git if needed, commit the files, and push to the repository using GitHub's displayed instructions. Review staged files first; do not commit `.env.local`, generated `dist/`, or credentials.

## 4. Vercel

Import the GitHub repository as a new Vercel project. Use Node 22 and these settings (also supplied by `vercel.json`):

| Setting | Value |
| --- | --- |
| Framework | Other |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variable | `SUPABASE_URL` |
| Environment variable | `SUPABASE_PUBLISHABLE_KEY` |

Set both environment variables for Production. Only enable account testing on Preview deployments after adding the intended preview URLs to Supabase's redirect allowlist. Deploy, then finish the Supabase Site URL and redirect settings using the actual production domain. Environment changes require a new deployment. See [Vercel project configuration](https://vercel.com/docs/project-configuration).

## 5. Verify the deployment

- Create and confirm a new account; log out and log in again.
- Request a reset email and save a new password from its link.
- Create a tournament, wait for “All changes saved,” refresh, and verify its data and display links remain unchanged.
- Log in using a second account and verify it cannot see the first account's tournaments.
- Open an overlay without logging in, keep its controller open, and test bidding, sold, and unsold transitions.
- Test from a phone and OBS. PeerJS still carries live display updates, so network/NAT restrictions can affect connections; hosting on Vercel does not replace this transport.

## Persistence and recovery

Each account owns a versioned JSON workspace (maximum 20 MB), including its tournament list, settings, player directory, and stable display IDs. Saves are automatic. Keep one active controller per account. If another device saves a newer revision, the app prevents a stale overwrite; download the pending backup before choosing Reload cloud version. A failed save remains cached under the account's user ID in that browser and can be retried when the connection returns. The JSON download is a recovery artifact; automatic JSON backup restoration is not implemented.

“Import local tournaments” imports standalone data from the same browser and site origin, skipping existing tournament IDs. Browser storage cannot be read across localhost and your Vercel domain. Existing source-mode data is not automatically transferred across domains.

Authentication and database integration tests use mocks locally. Email delivery, deployed RLS policies, and live provider connectivity must be checked against your newly created Supabase project using the checklist above.
