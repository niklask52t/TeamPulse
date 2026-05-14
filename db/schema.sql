CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_override TEXT,
    phone TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK(type IN ('training', 'tournament', 'other')),
    event_date TEXT NOT NULL,
    event_time TEXT NOT NULL,
    end_time TEXT,
    meeting_time TEXT,
    recurring INTEGER DEFAULT 0,
    recurrence_day INTEGER,
    poll_send_at TEXT,
    poll_send_minutes_before INTEGER DEFAULT 1440,
    poll_deadline_at TEXT,
    poll_deadline_minutes INTEGER DEFAULT 60,
    group_post_minutes_before INTEGER DEFAULT 60,
    event_reminder_minutes INTEGER DEFAULT 60,
    deadline_reminder_1_minutes INTEGER DEFAULT 120,
    deadline_reminder_2_minutes INTEGER DEFAULT 15,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    event_date TEXT NOT NULL,
    sent_at TEXT,
    send_after TEXT,
    deadline TEXT NOT NULL,
    reminder_sent INTEGER DEFAULT 0,
    reminder_2_sent INTEGER DEFAULT 0,
    group_posted INTEGER DEFAULT 0,
    event_reminder_sent INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'closed')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS poll_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    response TEXT CHECK(response IN ('yes', 'no', 'maybe')),
    reason TEXT,
    message_sent INTEGER DEFAULT 0,
    responded_at TEXT,
    FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
    UNIQUE(poll_id, contact_id)
);

CREATE TABLE IF NOT EXISTS group_description_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    position TEXT NOT NULL CHECK(position IN ('above', 'below')),
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    exception_date TEXT NOT NULL,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    UNIQUE(event_id, exception_date)
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
