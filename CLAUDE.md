# CLAUDE.md - TeamPulse

## Project Overview
WhatsApp-based attendance management dashboard. Users create events (recurring trainings, one-off tournaments), and TeamPulse automatically sends native WhatsApp polls to a group via WAHA. Participants from the group are auto-synced — no manual contact management. Responses are collected and posted to the group chat.

## Tech Stack
- **Backend**: Node.js 24 LTS + Express 5 (CommonJS)
- **Frontend**: Vanilla HTML/CSS/JS served as static files from `public/` — split into six files
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
│   ├── polls.js       # Poll management, manual actions, WAHA webhook
│   ├── stats.js       # Participation stats per contact
│   └── descriptionBlocks.js  # CRUD for group description static text blocks
├── services/
│   ├── waha.js        # WAHA API client (sendPollMessage, sendMessage, sendReminder, sendResultImage, sendMaybeFollowUp, postResultsToGroup, getGroupParticipants, getAllContacts, getGroups, updateGroupDescription)
│   ├── scheduler.js   # Cron: send/close/archive polls, reminders, group posts
│   ├── pollManager.js # Poll lifecycle (create, send, processResponse, processReasonMessage, close, extendDeadline)
│   ├── groupDescription.js  # Build & update WhatsApp group description (debounced)
│   ├── chartGenerator.js  # PNG bar chart via @napi-rs/canvas
│   └── timeUtils.js   # Europe/Berlin timezone helpers
├── public/            # Frontend static files (load order matters)
│   ├── index.html     # SPA with tabs: Events, Umfragen, Statistiken, Beschreibung + footer
│   ├── style.css
│   ├── changelog.js   # CHANGELOG data + renderChangelog()
│   ├── events.js      # Events tab: loadEvents, showEventForm, editEvent, saveEvent, deleteEvent
│   ├── polls.js       # Polls tab: loadPolls, renderPollDetail, buildActionButtons, pollAction, showExtendForm
│   ├── stats.js       # Stats tab: loadStats() — member response rate table
│   ├── description.js # Description tab: CRUD for static text blocks, preview, manual update
│   └── app.js         # Core: auth, nav, utils, groups, init — must load LAST
├── update.sh          # Production update/reset script
└── .env.example
```

## Key Conventions
- Default poll_send_minutes_before = 1440 (24h before event — when poll is sent)
- Default poll_deadline_minutes = 60 (1h before event — when poll closes AND results are posted)
- German UI, English code
- REST API endpoints under `/api/`
- All event times stored as Berlin local time, converted to UTC via parseBerlinDateTime()
- Use `const` by default, `let` when reassignment needed
- No TypeScript, keep it simple
- Express error handler logs all errors to console (visible in journalctl)
- **Frontend script load order**: changelog.js → events.js → polls.js → stats.js → description.js → app.js
  All files contribute to global scope (no ES modules) — app.js defines shared globals (API, apiFetch, esc, fmtDateFancy, etc.) and calls checkAuth() last
- Poll details auto-refresh every 15s via `openPollDetails` Set + `setInterval` in polls.js
- Footer is a sticky thin bar at the bottom; wiki/changelog/groups expand as panels above the bar
- Server binds to `0.0.0.0` (all interfaces) so external WAHA instances can reach the webhook

## Poll Lifecycle
1. **pending** → created (immediately when event is created, for both recurring and one-off), not yet sent
2. **active** → sent to group via WhatsApp, collecting responses
3. **closed** → deadline passed (auto by scheduler) or manually closed
4. **archived** → 24h after event ends, moved to archive

## Poll Creation
- **One-off events**: Poll created immediately when event is saved
- **Recurring events**: First poll created immediately for the next occurrence; subsequent polls created by `generateRecurringPolls()` in the scheduler
- Pending polls are shown in a collapsible "Ausstehend" section in the Umfragen tab

## Group Participant Sync
- Before sending a poll, `syncGroupParticipants()` fetches group members from WAHA
- Uses `GET /api/{session}/groups/{groupId}/participants/v2` for member list
- Uses `GET /api/contacts/all?session={session}` for display names
- Members are upserted into the `contacts` table (phone UNIQUE constraint)
- Poll responses reference contact IDs as before — no DB schema change needed

## Reason Follow-up Flow (Nein & Vielleicht)
- When someone votes 'maybe' or 'no' (poll.vote), a private WhatsApp message is sent asking for an optional reason
- The voter has **5 minutes** to reply with a reason — after that, `processReasonMessage()` ignores the message (SQL: `responded_at >= datetime('now', '-5 minutes')`)
- Only the next private message within the 5-minute window is saved as the reason
- Reasons are displayed in the poll detail view alongside the member's name for both "no" and "maybe" responses

## DEV_MODE
- `DEV_MODE=true` in `.env` enables the "Gruppen" footer tab (shows all WhatsApp groups with IDs from WAHA)
- Exposed to frontend via `GET /api/config` → `{ devMode: true/false }`
- Groups tab is hidden by default, only shown when DEV_MODE is true

## Scheduler Flow (every minute)
1. checkAndSendPolls — send pending polls when `send_after` time is reached
2. checkDeadlineReminders — 60min before deadline (shows actual deadline time, not minutes)
3. checkAndClosePolls — close active polls past deadline
4. checkGroupPosts — post results immediately for closed polls (no separate timing)
5. checkEventReminders — 1h before event
6. generateRecurringPolls — create next week's polls
7. archiveOldPolls — archive 24h after event

## Manual Actions (poll detail)
- Send poll: once only (pending → active), syncs group members first
- Send reminder: multiple times (active only) — sends plain text reminder to all non-voters with deadline time
- Extend deadline: adjustable via form (any minutes, resets reminder_sent=0 so another reminder can fire)
- Close poll: manual close (active → closed)
- Post group results: multiple times (active/closed) — sends text + PNG chart image; does NOT close the poll
- Send event reminder: multiple times (active/closed)
- Delete: always available

## Auth
- Default user: admin/admin, must_change_password=1
- Session-based auth via express-session (cookie, sameSite: strict)
- `/api/auth/*` routes are public, all other `/api/*` routes require session
- `/api/webhooks/waha` is public (machine-to-machine)
- `/api/groups` returns WhatsApp groups from WAHA (auth-required)

## Groups
- `GET /api/groups` (auth-required) fetches all WhatsApp groups from WAHA via `GET /api/{session}/groups`
- Displayed in a footer panel (lazy-loaded on first open) with group name, ID, and copy button
- Useful for finding the `GROUP_CHAT_ID` needed in `.env`

## WAHA Integration
- WAHA runs as separate Docker container (can be on a different VM)
- Native WhatsApp polls via POST /api/sendPoll — sent to GROUP_CHAT_ID (not individuals)
- Webhook at `/api/webhooks/waha` — req.url rewritten to `/webhook` before pollsRouter handles it
- Handles `message` (text reply), `poll.vote` (native poll), and `buttons_response` events
- Group messages: `payload.sender` = voter JID; private messages: `payload.from` = sender JID
- Poll options: "Ja ✅", "Nein ❌", "Vielleicht 🤷" — matched by emoji-stripped exact match first, then keyword includes
- `sendReminder` sends plain text reminder (sendButtons was removed — WA deprecated it for unofficial clients in 2024)
- `sendResultImage` sends a PNG chart via POST /api/sendFile (multipart first, JSON base64 fallback)

## Stats
- `GET /api/stats` returns per-contact totals from closed polls: yes/no/maybe/no_response + response_rate %
- Only closed polls count (open/pending polls don't penalize members)
- Frontend: Stats tab with sortable table + color-coded bar charts per member

## Group Description Auto-Update
- `services/groupDescription.js` builds description from: static blocks (above) + next event status + static blocks (below) + footer
- Footer: "Powered by TeamPulse by Niklas Kronig" + contact note
- Updated via `PUT /api/{session}/groups/{groupId}/description` (WAHA)
- **Debounced** — 15s for votes/poll changes, 120s for text block CRUD; "In WhatsApp aktualisieren" button for immediate push
- Triggered by: vote, reason, poll send/close, deadline extend, archive, new recurring poll
- Static blocks stored in `group_description_blocks` table (content, position: above/below, sort_order)
- Bot must be group admin to update description
- WhatsApp description limit: 2048 characters (auto-truncated)

## DB Schema Notes
- `events.meeting_time TEXT` — optional meeting/gathering time (separate from event_time)
- `events.end_time TEXT` — optional event end time (e.g. "20:30"), displayed in polls/messages/description
- `events.poll_send_minutes_before INTEGER DEFAULT 1440` — when to send the poll (minutes before event)
- `events.poll_send_at TEXT` — alternative fixed send date/time (e.g. "2026-03-20T10:00"), mutually exclusive with poll_send_minutes_before
- `polls.send_after TEXT` — ISO timestamp: earliest time the poll should be sent
- `poll_responses.reason TEXT` — stores optional reason from 'maybe' and 'no' voters
- `polls.archived INTEGER DEFAULT 0` — added via migration
- `contacts.lid TEXT` — WhatsApp Linked ID for poll.vote matching
- `group_description_blocks` — static text blocks for group description (content, position, sort_order)
- Run migrations in `db/database.js` with try/catch for existing columns
