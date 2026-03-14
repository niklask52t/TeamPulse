# CLAUDE.md - TeamPulse

## Project Overview
WhatsApp-based attendance management dashboard. Users create events (recurring trainings, one-off tournaments), and TeamPulse automatically sends native WhatsApp polls to a group via WAHA. Participants from the group are auto-synced — no manual contact management. Responses are collected and posted to the group chat.

## Tech Stack
- **Backend**: Node.js 24 LTS + Express 5 (CommonJS)
- **Frontend**: Vanilla HTML/CSS/JS served as static files from `public/` — split into four files
- **Database**: SQLite via libsql (better-sqlite3 compatible API), schema in `db/schema.sql`
- **Auth**: bcrypt + express-session, default user admin/admin, force password change on first login
- **Scheduler**: node-cron for timed messages (every minute)
- **WhatsApp**: WAHA REST API (native polls via sendPoll + poll.vote webhook)
- **Timezone**: All times in Europe/Berlin (via services/timeUtils.js)

## Project Structure
```
TeamPulse/
├── server.js          # Express app entry point + error handlers
├── db/
│   ├── schema.sql     # SQLite schema
│   └── database.js    # DB connection, migrations & seed
├── routes/
│   ├── auth.js        # Login, logout, password change
│   ├── events.js      # CRUD for events (validation, no past dates)
│   └── polls.js       # Poll management, manual actions, WAHA webhook
├── services/
│   ├── waha.js        # WAHA API client (sendPoll, sendText, sendReminder, sendMaybeFollowUp, getGroupParticipants, getAllContacts)
│   ├── scheduler.js   # Cron: send/close/archive polls, reminders, group posts
│   ├── pollManager.js # Poll lifecycle (create, send, processResponse, processReasonMessage, close)
│   └── timeUtils.js   # Europe/Berlin timezone helpers
├── public/            # Frontend static files (load order matters)
│   ├── index.html     # SPA with tabs: Events, Umfragen + footer with Wiki/Changelog
│   ├── style.css
│   ├── changelog.js   # CHANGELOG data + renderChangelog()
│   ├── events.js      # Events tab: loadEvents, showEventForm, editEvent, saveEvent, deleteEvent
│   ├── polls.js       # Polls tab: loadPolls, renderPollDetail, buildActionButtons, pollAction
│   └── app.js         # Core: auth, nav, utils, init — must load LAST
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
- **Frontend script load order**: changelog.js → events.js → polls.js → app.js
  All files contribute to global scope (no ES modules) — app.js defines shared globals (API, apiFetch, esc, fmtDateFancy, etc.) and calls checkAuth() last

## Poll Lifecycle
1. **pending** → created, not yet sent
2. **active** → sent to group via WhatsApp, collecting responses
3. **closed** → deadline passed (auto by scheduler) or manually closed
4. **archived** → 1h after event ends, moved to archive

## Group Participant Sync
- Before sending a poll, `syncGroupParticipants()` fetches group members from WAHA
- Uses `GET /api/{session}/groups/{groupId}/participants/v2` for member list
- Uses `GET /api/contacts/all?session={session}` for display names
- Members are upserted into the `contacts` table (phone UNIQUE constraint)
- Poll responses reference contact IDs as before — no DB schema change needed

## Vielleicht / Reason Flow
- When someone votes 'maybe' (poll.vote), a private WhatsApp message is sent asking for an optional reason
- If they reply privately (text message, non-group), `processReasonMessage()` checks if they have a recent 'maybe' response without a reason and saves it
- The reason is displayed in the poll detail view alongside their name

## Scheduler Flow (every minute)
1. checkAndSendPolls — send pending polls
2. checkDeadlineReminders — 60min before deadline (shows actual deadline time, not minutes)
3. checkAndClosePolls — close active polls past deadline
4. checkGroupPosts — post results for closed polls at scheduled time
5. checkEventReminders — 1h before event
6. generateRecurringPolls — create next week's polls
7. archiveOldPolls — archive 1h after event

## Manual Actions (poll detail)
- Send poll: once only (pending → active), syncs group members first
- Send reminder: multiple times (active only) — shows exact deadline time
- Close poll: manual close (active → closed)
- Post group results: multiple times (active/closed) — does NOT close the poll
- Send event reminder: multiple times (active/closed)
- Delete: always available

## Auth
- Default user: admin/admin, must_change_password=1
- Session-based auth via express-session (cookie, sameSite: strict)
- `/api/auth/*` routes are public, all other `/api/*` routes require session
- `/api/webhooks/waha` is public (machine-to-machine)

## WAHA Integration
- WAHA runs as separate Docker container
- Native WhatsApp polls via POST /api/sendPoll — sent to GROUP_CHAT_ID (not individuals)
- Webhook at `/api/webhooks/waha` — req.url rewritten to `/webhook` before pollsRouter handles it
- Handles both `message` (text reply) and `poll.vote` (native poll) events
- Group messages: `payload.sender` = voter JID; private messages: `payload.from` = sender JID
- Poll options: "Ja ✅", "Nein ❌", "Vielleicht 🤷" — matched by emoji-stripped exact match first, then keyword includes

## DB Schema Notes
- `poll_responses.reason TEXT` — stores optional reason from 'maybe' voters
- `polls.archived INTEGER DEFAULT 0` — added via migration
- Run migrations in `db/database.js` with try/catch for existing columns
