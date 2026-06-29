# Ayri Leaderboard Backend

Fastify API for the Ayri Leaderboard. It is designed for Railway hosting, Supabase Auth/Postgres, and a Vercel-hosted Next.js frontend.

## Environment

```txt
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
FRONTEND_ORIGIN=https://your-vercel-app.vercel.app
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-service-role-or-secret-key
BOOTSTRAP_ADMIN_TOKEN=random-long-one-time-secret
```

`SUPABASE_SECRET_KEY` must stay server-side only. Never expose it in the frontend.

## Supabase Setup

Apply the migration in `../supabase/migrations/20260629134424_initial_backend_schema.sql`.

With Supabase CLI:

```bash
npx supabase link --project-ref your-project-ref
npx supabase db push
```

Without CLI, open the Supabase SQL editor and run the migration SQL once.

## First Admin

After deploying the backend with `BOOTSTRAP_ADMIN_TOKEN`, create the first admin once:

```bash
curl -X POST https://your-railway-api.up.railway.app/v1/bootstrap/admin \
  -H "content-type: application/json" \
  -H "x-bootstrap-token: $BOOTSTRAP_ADMIN_TOKEN" \
  -d "{\"displayName\":\"Timo\",\"email\":\"timo@mail.com\",\"password\":\"change-this-long-password\"}"
```

After the first admin exists, remove `BOOTSTRAP_ADMIN_TOKEN` from Railway or rotate it.

## Main API

- `GET /health`
- `GET /v1/drink-types`
- `POST /v1/invitations`
- `GET /v1/me`
- `GET /v1/leaderboard`
- `GET /v1/activity?limit=10`
- `POST /v1/drink-entries`
- `GET /v1/participants/:userId/history`
- `GET /v1/admin/invitations`
- `POST /v1/admin/invitations/:invitationId/accept`
- `POST /v1/admin/invitations/:invitationId/reject`
- `POST /v1/admin/users/:userId/reset-password`

Protected routes require:

```txt
Authorization: Bearer <supabase-access-token>
```

## Verification

```bash
npm run build
npm test
```
