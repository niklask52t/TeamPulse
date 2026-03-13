# CLAUDE.md - TeamPulse

## Project Overview
WhatsApp-based attendance management dashboard. Users create events (recurring trainings, one-off tournaments), manage phone contacts, and send automated native WhatsApp polls via WAHA. Responses are collected and posted to a group chat.

## Tech Stack
- **Backend**: Node.js 24 LTS + Express 5 (CommonJS)
- **Frontend**: Vanilla HTML/CSS/JS served as static files from `public/`
- **Database**: SQLite via libsql (better-sqlite3 compatible API), schema in `db/schema.sql`
- **Auth**: bcrypt + express-session, default user admin/admin, force password change on first login
- **Scheduler**: node-cron for timed messages (reminders, group posts, auto-close, archiving)
- **WhatsApp**: WAHA REST API (native polls via sendPoll + poll.vote webhook)
- **Timezone**: All times in Europe/Berlin (via services/timeUtils.js)

## Project Structure
```
TeamPulse/
├── server.js          # Express app entry point + error handlers
├── db/
│   ├── schema.sql     # SQLite schema (polls.archived column)
│   └── database.js    # DB connection, migrations & seed
├── routes/
│   ├── auth.js        # Login, logout, password change
│   ├── events.js      # CRUD for events (validation, no past dates)
│   ├── contacts.js    # CRUD for contacts
│   └── polls.js       # Poll management, manual actions, WAHA webhook
├── services/
│   ├── waha.js        # WAHA API client (sendPoll, sendText, sendReminder)
│   ├── scheduler.js   # Cron: send/close/archive polls, reminders, group posts
│   ├── pollManager.js # Poll lifecycle (create, send, processResponse, close)
│   └── timeUtils.js   # Europe/Berlin timezone helpers
├── public/            # Frontend static files
│   ├── index.html     # SPA with tabs: Events, Kontakte, Umfragen, Wiki, Changelog
│   ├── style.css
│   └── app.js         # Frontend logic + changelog data
├── update.sh          # Production update/reset script
└── .env.example
```

## Key Conventions
- German UI, English code
- REST API endpoints under `/api/`
- All event times stored as Berlin local time, converted to UTC via parseBerlinDateTime()
- Use `const` by default, `let` when reassignment needed
- No TypeScript, keep it simple
- Express error handler logs all errors to console (visible in journalctl)

## Poll Lifecycle
1. **pending** → created, not yet sent
2. **active** → sent via WhatsApp, collecting responses
3. **closed** → deadline passed (auto or manual), group result can be posted
4. **archived** → 1h after event ends, moved to archive

## Scheduler Flow (every minute)
1. checkAndSendPolls — send pending polls
2. checkDeadlineReminders — 60min before deadline
3. checkAndClosePolls — close active polls past deadline
4. checkGroupPosts — post results for closed polls at scheduled time
5. checkEventReminders — 1h before event
6. generateRecurringPolls — create next week's polls
7. archiveOldPolls — archive 1h after event

## Manual Actions (polls detail)
- Send poll: once only (pending → active)
- Send reminder: multiple times (active only)
- Post group results: multiple times (active/closed)
- Send event reminder: multiple times (active/closed)
- Delete: always available

## Auth
- Default user: admin/admin, must_change_password=1
- Session-based auth via express-session (cookie, sameSite: strict)
- `/api/auth/*` routes are public, all other `/api/*` routes require session
- `/api/webhooks/waha` is public (machine-to-machine)

## WAHA Integration
- WAHA runs as separate Docker container
- Native WhatsApp polls via POST /api/sendPoll
- Webhook at `/api/webhooks/waha` handles both `message` and `poll.vote` events
- Poll options: "Ja", "Nein", "Vielleicht" — matched by keyword in processResponse()
