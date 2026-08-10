# CLAUDE.md - TeamPulse

## Project Overview
WhatsApp-based attendance management dashboard. Users create events (recurring trainings, one-off tournaments), and TeamPulse automatically sends native WhatsApp polls to a group via Evolution. Participants from the group are auto-synced — no manual contact management. Responses are collected and posted to the group chat.

## Tech Stack
- **Backend**: Node.js 24 LTS + Express 5 (CommonJS)
- **Frontend**: Vanilla HTML/CSS/JS served as static files from `public/` — split into seven files
- **Database**: SQLite via libsql (better-sqlite3 compatible API), schema in `db/schema.sql`
- **Auth**: bcrypt + express-session, initial user `admin` with a random or ADMIN_INITIAL_PASSWORD-seeded password (printed once), force password change on first login
- **Scheduler**: node-cron for timed messages (every minute)
- **WhatsApp**: Evolution REST API (native polls via sendPoll + poll.vote webhook)
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
│   ├── contacts.js    # Contact list, name overrides, LID mapping
│   ├── dashboard.js   # Aggregated dashboard data
│   ├── events.js      # CRUD for events (validation, no past dates)
│   ├── polls.js       # Poll management, manual actions, Evolution webhook
│   ├── settings.js    # App settings (result post mode, description slow mode)
│   ├── stats.js       # Participation stats per contact
│   └── descriptionBlocks.js  # CRUD for group description static text blocks
├── services/
│   ├── evolution.js        # Evolution API client (sendPollMessage, sendMessage, sendResultImage, sendDeadlineReminderToGroup, sendEventReminderToGroup, postResultsToGroup, sendCancellationMessage, getGroupParticipants, getAllContacts, getGroups, updateGroupDescription)
│   ├── scheduler.js   # Cron: send/close/archive polls, reminders, group posts
│   ├── sessionStore.js # SQLite-backed express-session store
│   ├── pollManager.js # Poll lifecycle (create, send, resend, processResponse, close, extendDeadline) + extractMessageId helper
│   ├── groupDescription.js  # Build & update WhatsApp group description (debounced)
│   ├── chartGenerator.js  # PNG bar chart via @napi-rs/canvas
│   └── timeUtils.js   # Europe/Berlin timezone helpers
├── public/            # Frontend static files (load order matters)
│   ├── index.html     # SPA with tabs: Dashboard, Events, Umfragen, Statistiken, Kontakte, Einstellungen, Beschreibung + footer
│   ├── style.css
│   ├── changelog.js   # CHANGELOG data + renderChangelog()
│   ├── dashboard.js   # Dashboard tab: loadDashboard() — overview with countdown, active polls, trend
│   ├── events.js      # Events tab: loadEvents, showEventForm, editEvent, saveEvent, deleteEvent, exceptions
│   ├── polls.js       # Polls tab: loadPolls, renderPollDetail, buildActionButtons, pollAction, showExtendForm
│   ├── stats.js       # Stats tab: loadStats() — member response rate table
│   ├── contacts.js    # Contacts tab: loadContacts, name overrides
│   ├── settings.js    # Settings tab: loadSettings, saveSettings
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
- **Frontend script load order**: changelog.js → dashboard.js → events.js → polls.js → stats.js → description.js → app.js
  All files contribute to global scope (no ES modules) — app.js defines shared globals (API, apiFetch, esc, fmtDateFancy, etc.) and calls checkAuth() last
- Poll details auto-refresh every 15s via `openPollDetails` Set + `setInterval` in polls.js
- Footer is a sticky thin bar at the bottom; wiki/changelog/groups expand as panels above the bar
- Server binds to `0.0.0.0` (all interfaces) so external Evolution instances can reach the webhook

## Poll Lifecycle
1. **pending** → created (immediately when event is created, for both recurring and one-off), not yet sent
1.5. **sending** → in-memory lock via `sendingPolls` Set (not in DB) while Evolution call is in progress (prevents duplicate sends from overlapping scheduler ticks). Lock released on success or error.
2. **active** → sent to group via WhatsApp, collecting responses
3. **closed** → deadline passed (auto by scheduler) or manually closed
4. **archived** → 24h after event ends, moved to archive

## Poll Creation
- **One-off events**: Poll created immediately when event is saved
- **Recurring events**: First poll created immediately for the next occurrence; subsequent polls created by `generateRecurringPolls()` in the scheduler
- Pending polls are shown in a collapsible "Ausstehend" section in the Umfragen tab

## Group Participant Sync
- Before sending a poll, `syncGroupParticipants()` fetches group members from Evolution
- Uses `GET /api/{session}/groups/{groupId}/participants/v2` for member list
- Uses `GET /api/contacts/all?session={session}` for display names
- Members are upserted into the `contacts` table (phone UNIQUE constraint)
- Poll responses reference contact IDs as before — no DB schema change needed

## No Private Messages
- TeamPulse never sends private/direct WhatsApp messages — ALL outgoing messages go to the group (poll, reminders, results, cancellation, description)
- The former DM features (comment/reason follow-ups, too-late notification, admin vote notification, reason-request DMs, per-contact reason_dm setting) were removed completely in v3.0.0
- Incoming private messages are ignored by the webhook; only poll updates are processed
- Votes after deadline are simply ignored (logged, no notification)
- All automatic messages end with "🤖 Automatisch generierte Nachricht von TeamPulse"

## DEV_MODE
- `DEV_MODE=true` in `.env` enables the "Gruppen" footer tab (shows all WhatsApp groups with IDs from Evolution)
- Exposed to frontend via `GET /api/config` → `{ devMode: true/false }`
- Groups tab is hidden by default, only shown when DEV_MODE is true

## Scheduler Flow (every minute)
1. checkAndSendPolls — send pending polls when `send_after` time is reached (pins poll message)
2. checkDeadlineReminders — two reminders per poll (configurable per event, default 120min + 15min before deadline)
3. checkAndClosePolls — close active polls past deadline (unpins poll message)
4. checkGroupPosts — post results immediately for closed polls (pins result message)
5. checkEventReminders — configurable per event (default 60min before event)
6. generateRecurringPolls — create next week's polls
7. archiveOldPolls — archive 24h after event
8. unpinExpiredResults — unpin result messages after event ends (end_time or event_time)
9. checkDescriptionEventSwitch — update group description when current event ends (end_time or event_time)

## Manual Actions (poll detail)
- Send poll: once only (pending → active), syncs group members first
- Send reminder: multiple times (active only) — one group message listing all non-voters with deadline time (skipped if everyone voted)
- Extend deadline: adjustable via form (any minutes, resets both reminder flags so reminders fire again)
- Close poll: manual close (active → closed)
- Post group results: multiple times (active/closed) — sends text + PNG chart image; does NOT close the poll
- Send event reminder: multiple times (active/closed) — one group message listing all yes-voters (skipped if none)
- Manual vote override: click member name → set response (✅/❌/🤷/⏳). Works on all polls including archived — stats update accordingly
- Resend (reset): active only — clears all votes, unpins old poll, sends new WhatsApp poll, resets reminder flags
- Delete: always available

## Auth
- Initial user: `admin` with a randomly-generated (or ADMIN_INITIAL_PASSWORD) password, must_change_password=1 — no hardcoded default credential
- Login regenerates the session (anti session-fixation) and returns a fresh csrfToken; password min length 10
- change-password requires the current password; login runs a constant-cost bcrypt compare even for unknown users (anti timing-enumeration)
- Session-based auth via express-session (cookie, sameSite: strict, SQLite-backed store)
- CSRF: double-submit token in session, required on all non-GET requests via x-csrf-token header
- `trust proxy` is off by default (loopback only); set TRUST_PROXY when behind a real reverse proxy so rate limiting can't be bypassed via X-Forwarded-For
- Security headers (nosniff, X-Frame-Options DENY, Referrer-Policy) + JSON body limit 256kb
- `/api/auth/*` routes are public, all other `/api/*` routes require session
- `/api/webhooks/evolution` is public (machine-to-machine), rate-limited; set WEBHOOK_SECRET to require an apikey/x-webhook-secret header
- `/api/groups` returns WhatsApp groups from Evolution (auth-required)

## Groups
- `GET /api/groups` (auth-required) fetches all WhatsApp groups from Evolution via `GET /api/{session}/groups`
- Displayed in a footer panel (lazy-loaded on first open) with group name, ID, and copy button
- Useful for finding the `GROUP_CHAT_ID` needed in `.env`

## Evolution Integration
- Evolution runs as separate Docker container (can be on a different VM)
- Native WhatsApp polls via POST /api/sendPoll — sent to GROUP_CHAT_ID (not individuals)
- Webhook at `/api/webhooks/evolution` — req.url rewritten to `/webhook` before pollsRouter handles it
- Handles poll updates (MESSAGES_UPSERT / MESSAGES_UPDATE); plain text messages (group or private) are ignored
- Poll options: "Ja", "Nein", "Vielleicht" — matched by emoji-stripped exact match
- Vote matching: `processResponse(phone, text, pollMessageId)` matches votes to polls by Evolution poll_message_id first; single-active-poll-without-message-id fallback only
- Deadline & event reminders are single group messages (sendDeadlineReminderToGroup / sendEventReminderToGroup)
- `sendResultImage` sends a PNG chart via POST /api/sendFile (multipart first, JSON base64 fallback)
- `pinMessage` / `unpinMessage` via PUT/DELETE `/api/{session}/chats/{chatId}/messages/{messageId}/pin`
- Auto-pin: poll pinned on send, unpinned on close; result pinned on post, unpinned after event ends

## Stats
- `GET /api/stats` returns per-contact totals from closed polls: yes/no/maybe/no_response + response_rate %
- Only closed polls count (open/pending polls don't penalize members)
- Frontend: Stats tab with sortable table + color-coded bar charts per member

## Group Description Auto-Update
- `services/groupDescription.js` builds description from: static blocks (above) + next event (full detail) + remaining active polls (compact one-liner with emoji counts) + pending poll + static blocks (below) + upcoming events + footer
- Only 1 active poll shown with full vote breakdown (MAX_ACTIVE_IN_DESC=1), remaining active polls shown under "📋 Weitere aktive Umfragen:" as compact summary: `🗳 Title – Date, Time — ✅X ❌X 🤷X`
- Footer: "Powered by TeamPulse by Niklas Kronig" + contact note
- Updated via `PUT /api/{session}/groups/{groupId}/description` (Evolution)
- **Debounced** — 60s for votes/poll changes, 60s for text block CRUD; "In WhatsApp aktualisieren" button for immediate push
- Triggered by: vote, reason, poll send/close, deadline extend, archive, new recurring poll
- Static blocks stored in `group_description_blocks` table (content, position: above/below, sort_order)
- Bot must be group admin to update description
- WhatsApp description limit: 2048 characters (auto-truncated)

## DB Schema Notes
- `events.meeting_time TEXT` — optional meeting/gathering time (separate from event_time)
- `events.end_time TEXT` — optional event end time (e.g. "20:30"), displayed in polls/messages/description
- `events.poll_send_minutes_before INTEGER DEFAULT 1440` — when to send the poll (minutes before event)
- `events.poll_send_at TEXT` — alternative fixed send date/time (e.g. "2026-03-20T10:00"), mutually exclusive with poll_send_minutes_before
- `events.poll_deadline_at TEXT` — alternative fixed deadline date/time, mutually exclusive with poll_deadline_minutes
- `events.event_reminder_minutes INTEGER DEFAULT 60` — minutes before event for start reminder to yes-voters
- `events.deadline_reminder_1_minutes INTEGER DEFAULT 120` — first deadline reminder (minutes before deadline)
- `events.deadline_reminder_2_minutes INTEGER DEFAULT 15` — second deadline reminder (minutes before deadline)
- `events.description TEXT` — optional event description shown everywhere
- `polls.send_after TEXT` — ISO timestamp: earliest time the poll should be sent
- `polls.reminder_2_sent INTEGER DEFAULT 0` — tracks second deadline reminder
- `polls.poll_message_id TEXT` — Evolution message ID of the sent poll (for pinning/unpinning)
- `polls.result_message_id TEXT` — Evolution message ID of the result post (for pinning/unpinning)
- `polls.result_unpinned INTEGER DEFAULT 0` — tracks whether result message has been unpinned after event end
- `events.auto_cancel INTEGER DEFAULT 0` — if 1, send cancellation when yes < min_participants at deadline
- `events.min_participants INTEGER DEFAULT 0` — minimum yes count for auto-cancel
- `polls.archived INTEGER DEFAULT 0` — added via migration
- `poll_responses.reason` and `contacts.reason_dm_enabled` were removed in v3.0.0 (drop migrations in db/database.js)
- `contacts.lid TEXT` — WhatsApp Linked ID for poll.vote matching
- `group_description_blocks` — static text blocks for group description (content, position, sort_order)
- `event_exceptions` — dates to skip for recurring events (event_id, exception_date, reason), UNIQUE(event_id, exception_date)
- Run migrations in `db/database.js` with try/catch for existing columns

## Dashboard
- Default landing tab with key metrics at a glance
- Shows: next event with live countdown, active polls with progress bars, quick stats (events/members/response rate/closed), response trend (last 10 closed polls)
- All stats (response rate, closed count) based exclusively on closed polls
- `GET /api/dashboard` returns all data in one call
- Tab switching always reloads data to prevent stale content

## Auto-Cancel
- Optional per-event setting: `auto_cancel` flag + `min_participants` count
- When poll deadline passes and yes_count < min_participants, sends cancellation message to group
- Results post includes cancellation notice
- Shown in event card, poll detail, and dashboard active polls

## Recurring Event Exceptions
- `event_exceptions` table stores dates to skip for recurring events
- `GET/POST/DELETE /api/events/:id/exceptions` for CRUD
- Scheduler skips excepted dates when generating polls and sending
- UI: exception management in event edit form (date picker + optional reason)

## Event Descriptions
- Optional `description` field per event, displayed everywhere: WhatsApp polls, reminders, result posts, cancellation messages, group description, dashboard, event cards, poll details
- Shown with 📝 prefix

## Configurable Reminders
- **Event start reminder**: `event_reminder_minutes` (default 60), one group message listing all yes-voters with dynamic time label
- **Deadline reminders**: two per poll — `deadline_reminder_1_minutes` (default 120) and `deadline_reminder_2_minutes` (default 15), each one group message listing all non-voters
- `polls.reminder_2_sent` tracks second reminder; `extendDeadline` resets both flags
- All timings configurable per event in the form

## Time Validation
- `meeting_time` must be before `event_time` (frontend alert + backend 400)
- `end_time` must be after `event_time` (frontend alert + backend 400)

## Fixed Deadline Date
- Like `poll_send_at`, the deadline can be a fixed date/time (`poll_deadline_at`) instead of "hours before event"
- Not available for recurring events (same as fixed send date)

## Message Formatting
- All outgoing WhatsApp messages share one structure: emoji header line with *bold* title, blank line, emoji info block (🗓 date, 🕒 time window, 🤝 meeting time, 📝 description), content section, AUTO_HINT footer
- Shared builder: `buildEventInfoLines()` in services/evolution.js
- Dates formatted as "Fr, 14.08.2026" (fmtDate), time windows as "19:00–21:00 Uhr" (formatEventWindow)
- All automatic messages include "🤖 Automatisch generierte Nachricht von TeamPulse" hint
