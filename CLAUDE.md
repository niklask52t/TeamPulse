# CLAUDE.md - TeamPulse

## Project Overview
WhatsApp-based attendance management dashboard. Users create events (recurring trainings, one-off tournaments), manage phone contacts, and send automated WhatsApp polls via WAHA. Responses are collected and posted to a group chat.

## Tech Stack
- **Backend**: Node.js + Express (CommonJS)
- **Frontend**: Vanilla HTML/CSS/JS served as static files from `public/`
- **Database**: SQLite via better-sqlite3, schema in `db/schema.sql`
- **Auth**: bcrypt + express-session, default user admin/admin, force password change on first login
- **Scheduler**: node-cron for timed messages (reminders, group posts)
- **WhatsApp**: WAHA REST API

## Project Structure
```
TeamPulse/
├── server.js          # Express app entry point
├── db/
│   ├── schema.sql     # SQLite schema
│   └── database.js    # DB connection & helpers
├── routes/
│   ├── auth.js        # Login, logout, password change
│   ├── events.js      # CRUD for events
│   ├── contacts.js    # CRUD for contacts
│   └── polls.js       # Poll management & results
├── services/
│   ├── waha.js        # WAHA API client
│   ├── scheduler.js   # Cron jobs for reminders
│   └── pollManager.js # Poll lifecycle management
├── public/            # Frontend static files
│   ├── index.html
│   ├── style.css
│   └── app.js
└── .env.example
```

## Key Conventions
- German UI, English code
- REST API endpoints under `/api/`
- All times stored as UTC in DB, converted for display
- Use `const` by default, `let` when reassignment needed
- No TypeScript, keep it simple

## Commands
- `npm start` — Start server
- `npm run dev` — Start with nodemon (hot reload)

## Auth
- Default user: admin/admin, must_change_password=1
- Session-based auth via express-session (cookie)
- `/api/auth/*` routes are public, all other `/api/*` routes require session
- `/api/webhooks/waha` is public (machine-to-machine)
- DB seeds default admin user on first run if users table is empty

## WAHA Integration
- WAHA runs as separate Docker container
- Webhook endpoint at `/api/webhooks/waha` receives message responses
- Polls use simple text messages with reply-based voting (Ja/Nein)
