# DataStudio

DataStudio now includes a frontend, a Node backend, Google/Apple login scaffolding, admin usage analytics, and privacy-minded dataset summary storage.

## Start Locally

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Do not use VS Code Live Server for this project. Routes like `/login`, `/admin`, `/auth/google`, and `/api/*` are served by the Node backend.

## What Was Added

- Required login before users can access the main workspace.
- Google and Apple OAuth routes.
- Session cookies.
- User tracking with login count, first seen, last seen, and visit count.
- Admin dashboard at `/admin`.
- Backend stats at `/api/admin/stats`.
- Admin export at `/api/admin/export`.
- Contact and dataset activity tracking.
- Optional MongoDB storage.
- JSON-file fallback storage for local development.

## Admin Access

Set your admin email in `.env`:

```text
ADMIN_EMAILS=your-email@example.com
```

If `ADMIN_EMAILS` is empty, the first user who logs in is treated as admin for local testing. For production, always set `ADMIN_EMAILS`.

## Google Login Setup

Create a Google OAuth web app and add this redirect URI:

```text
http://localhost:3000/auth/google/callback
```

Then set:

```text
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

## Apple Login Setup

Apple login requires an Apple Developer account and Sign in with Apple service ID/key.

Redirect URL:

```text
http://localhost:3000/auth/apple/callback
```

Set:

```text
APPLE_CLIENT_ID=your-apple-service-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

## Storage: JSON vs MongoDB

You do not need MongoDB to run locally. By default, the backend stores data in local JSON files:

- `server/data/users.json`
- `server/data/sessions.json`
- `server/data/contacts.json`
- `server/data/datasets.json`
- `server/data/events.json`

For production, use MongoDB Atlas or another managed database. To enable MongoDB:

1. Install dependencies:

```bash
npm install
```

2. Add this to `.env`:

```text
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=datastudio
```

3. Restart:

```bash
npm start
```

If MongoDB is not reachable, the backend falls back to JSON storage and prints a warning.

## Privacy Defaults

The backend does not store full uploaded files. It stores:

- File name
- Row counts
- Column profiles
- Cleaning options
- A small sample of rows

Control sample size with:

```text
DATASET_ANALYSIS_LIMIT=500
DATASET_SAMPLE_LIMIT=10
```

## Useful URLs

- `/login` user login
- `/` main workspace
- `/admin` admin dashboard
- `/api/health` server health
- `/api/auth/config` login/storage config
- `/api/me` current user
- `/api/admin/stats` admin stats
- `/api/admin/export` admin JSON export
