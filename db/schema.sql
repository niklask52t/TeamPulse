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
    phone TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('training', 'tournament', 'other')),
    event_date TEXT NOT NULL,
    event_time TEXT NOT NULL,
    recurring INTEGER DEFAULT 0,
    recurrence_day INTEGER,
    poll_deadline_minutes INTEGER DEFAULT 120,
    group_post_minutes_before INTEGER DEFAULT 60,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    event_date TEXT NOT NULL,
    sent_at TEXT,
    deadline TEXT NOT NULL,
    reminder_sent INTEGER DEFAULT 0,
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
