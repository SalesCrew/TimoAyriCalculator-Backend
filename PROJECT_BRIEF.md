# Ayri Leaderboard Project Brief

Diese Datei ist die gemeinsame Referenz fuer das Projekt. Wenn spaeter Entscheidungen unklar werden, zuerst hier nachsehen und bei Aenderungen diese Datei aktualisieren.

## Projektidee

Timo und Freunde wollen fuer die Maturareise ein internes Leaderboard, in dem alkoholische Getraenke eingetragen werden. Das Ranking basiert nicht auf der Anzahl der Bier, sondern auf der tatsaechlichen Menge reinem Alkohol in ml.

Der User mit den meisten ml reinem Alkohol ueber den Wettbewerb gewinnt. Der User mit dem niedrigsten Wert wird als "Groesster Ayri" angezeigt. Der Ton darf intern frech sein, aber die App soll hochwertig und nicht billig/chaotisch wirken.

Wichtig: Die App soll als Tracking-Tool funktionieren, nicht als Aufforderung zum riskanten Trinken. Spaetere Safety-Features wie Wasser-Reminder, Tageslimit-Anzeige oder ein "Pause"-Hinweis sind erlaubt, solange sie das UI nicht nervig machen.

## Zielarchitektur

- `frontend/`: Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui, Vercel Deployment.
- `backend/`: TypeScript API mit Fastify, Railway Deployment.
- Datenbank: Supabase Postgres.
- Auth: Supabase Auth mit Multi-User-Accounts fuer alle Teilnehmer.
- Frontend spricht mit dem Backend fuer App-Mutationen.
- Backend validiert spaeter Supabase-JWTs und schreibt/liest kontrolliert aus Supabase.
- Supabase Row Level Security bleibt Pflicht fuer Tabellen im exposed Schema.

## Aktuelle Tech-Entscheidungen

- Package Manager: npm.
- Frontend UI-Basis: shadcn/ui plus lucide-react Icons.
- Animationen: `motion` fuer hochwertige, ruhige Transitions.
- Formulare: `react-hook-form`, `zod`, `@hookform/resolvers`.
- Supabase Next.js Integration: `@supabase/ssr` und `@supabase/supabase-js`.
- Backend Framework: Fastify mit `@fastify/cors`.
- Backend Env-Validierung: `zod`.

## Kernfunktionen

1. Account erstellen und einloggen.
2. Teilnehmerprofil anzeigen.
3. Landing/Homepage zeigt:
   - Top 3 auf einem Stockerl.
   - Leaderboard darunter.
   - Den User mit dem niedrigsten Alkoholwert als "Groesster Ayri".
4. Drink schnell eintragen:
   - Getraenk aus Liste waehlen.
   - Menge in ml eingeben.
   - Reinen Alkohol automatisch berechnen.
   - Eintrag submitten.
5. Wettbewerb gilt fuer Sommer 2026.
   - Default-Fenster: `2026-06-21` bis `2026-09-22`, Zeitzone `Europe/Vienna`.
   - Spaeter in der DB konfigurierbar halten.

## Alkoholberechnung

Formel:

```txt
reiner_alkohol_ml = getraenkemenge_ml * (alkohol_prozent / 100)
```

Beispiel:

```txt
500 ml Bier mit 5.0% = 500 * 0.05 = 25 ml reiner Alkohol
```

Wir speichern vorzugsweise:

- `drink_volume_ml`
- `abv_percent`
- `pure_alcohol_ml`
- `drink_type_id`
- `user_id`
- `consumed_at`

`pure_alcohol_ml` wird serverseitig berechnet, damit niemand im Frontend tricksen kann.

## Starter-Getraenkeliste

Mindestens diese 20+ Drinks als Seed-Daten vorsehen:

| Name | ABV % |
| --- | ---: |
| Maerzen Bier | 5.0 |
| Lager | 4.8 |
| Pils | 5.1 |
| Radler | 2.5 |
| Weizenbier | 5.4 |
| Starkbier | 7.5 |
| Cider | 4.5 |
| Prosecco | 11.0 |
| Sekt | 12.0 |
| Weisswein | 12.5 |
| Rotwein | 13.5 |
| Rose | 12.0 |
| Aperol Spritz | 8.0 |
| Hugo | 6.5 |
| Vodka | 40.0 |
| Gin | 40.0 |
| Rum | 40.0 |
| Tequila | 38.0 |
| Whiskey | 40.0 |
| Jaegermeister | 35.0 |
| Limoncello | 30.0 |
| Baileys | 17.0 |
| Malibu | 21.0 |
| Korn | 32.0 |
| Shot Mix | 20.0 |
| Hard Seltzer | 4.5 |
| Energy Vodka Mix | 10.0 |

ABV-Werte sind Default-Werte. Spaeter sollen Drinks editierbar oder pro Eintrag ueberschreibbar sein, falls ein Produkt abweicht.

## Datenmodell Entwurf

Tabellen spaeter in Supabase:

- `profiles`
  - `id uuid primary key references auth.users(id)`
  - `display_name text not null`
  - `avatar_url text`
  - `created_at timestamptz`
- `drink_types`
  - `id uuid primary key`
  - `name text not null`
  - `abv_percent numeric not null`
  - `category text`
  - `is_active boolean default true`
- `drink_entries`
  - `id uuid primary key`
  - `user_id uuid not null references profiles(id)`
  - `drink_type_id uuid references drink_types(id)`
  - `drink_name_snapshot text not null`
  - `drink_volume_ml numeric not null`
  - `abv_percent numeric not null`
  - `pure_alcohol_ml numeric not null`
  - `consumed_at timestamptz not null`
  - `created_at timestamptz`
- `competition_settings`
  - `id text primary key`
  - `starts_at timestamptz not null`
  - `ends_at timestamptz not null`

Supabase-Hinweis: Neue Tabellen muessen mit RLS abgesichert werden. Falls Tabellen ueber die Data API erreichbar sein sollen, muessen Rollen/Privileges explizit gesetzt werden.

Aktueller Backend-Stand:

- Supabase-Migration liegt in `supabase/migrations/20260629134424_initial_backend_schema.sql`.
- Rollen sind `admin` und `user`.
- Autorisierung laeuft ueber `auth.users.app_metadata.role`, nicht ueber editierbare User-Metadaten.
- Erstes Admin-Konto kann ueber `POST /v1/bootstrap/admin` mit `BOOTSTRAP_ADMIN_TOKEN` erstellt werden.
- Danach verwaltet der Admin Anfragen ueber `/admin/invitations` im Frontend.
- Akzeptieren einer Anfrage erstellt einen Supabase-Auth-User, ein `profiles`-Profil und gibt ein temporaeres Passwort einmalig zurueck.
- App-API laeuft serverseitig ueber Railway/Fastify und nutzt den Supabase Secret/Service Key nur im Backend.

Wichtige API-Routen:

- `POST /v1/invitations`
- `GET /v1/me`
- `GET /v1/drink-types`
- `GET /v1/leaderboard`
- `GET /v1/activity`
- `POST /v1/drink-entries`
- `GET /v1/participants/:userId/history`
- `GET /v1/admin/invitations`
- `POST /v1/admin/invitations/:invitationId/accept`
- `POST /v1/admin/invitations/:invitationId/reject`
- `POST /v1/admin/users/:userId/reset-password`

## Auth-Regeln

- Jeder Teilnehmer hat einen eigenen Supabase-Auth-Account.
- Frontend nutzt nur Publishable Key / public env vars.
- Backend darf Secret Key nur serverseitig halten.
- `user_metadata` wird nicht fuer Berechtigungen verwendet.
- Berechtigungen laufen ueber DB-Policies, `auth.uid()` und ggf. App-Metadaten.
- Backend validiert bei geschuetzten Routen das Supabase Access Token.

## UI-Richtung

Look: cleanes White-on-White SaaS UI, hochwertig, ruhig, minimalistisch.

Design-Prinzipien:

- Weisser Hintergrund mit feinen Borders, Schatten nur sehr subtil.
- Keine bunten Party-Grafiken als Default.
- Klare Typografie mit Geist.
- Cards nur fuer echte Einheiten wie Leaderboard-Zeilen, Dialoge, Formbereiche.
- Keine verschachtelten Cards.
- Saubere Micro-Interactions: leichte Scale/Fade/Slide Transitions.
- Buttons und Controls nutzen shadcn/ui.
- Icons ueber lucide-react.
- Mobile first, aber Desktop soll dashboardartig und hochwertig wirken.

## Step-by-Step Plan

1. Projekt initialisieren und Projekt-Brief festhalten.
2. Frontend-Foundation:
   - App Shell
   - Theme
   - Live-Leaderboard
   - Drink-Submit UI gegen Backend
3. Auth-UI:
   - Login
   - Registrierung
   - Session Handling
4. Backend API:
   - Health
   - Auth Middleware
   - Drink Submit Endpoint
   - Leaderboard Endpoint
5. Supabase Schema:
   - Migrations
   - Seed Drinks
   - RLS Policies
6. Frontend an echte API anbinden.
7. Deployment:
   - Vercel Frontend
   - Railway Backend
   - Supabase Env Vars

## Lokale Ports

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`
