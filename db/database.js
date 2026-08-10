const Database = require('libsql');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'teampulse.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migrations for existing databases
try { db.exec('ALTER TABLE polls ADD COLUMN archived INTEGER DEFAULT 0'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN meeting_time TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN poll_send_minutes_before INTEGER DEFAULT 1440'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE polls ADD COLUMN send_after TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE contacts ADD COLUMN lid TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE contacts ADD COLUMN name_override TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN end_time TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN poll_send_at TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN description TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN auto_cancel INTEGER DEFAULT 0'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN min_participants INTEGER DEFAULT 0'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN poll_deadline_at TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN event_reminder_minutes INTEGER DEFAULT 60'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN deadline_reminder_1_minutes INTEGER DEFAULT 120'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN deadline_reminder_2_minutes INTEGER DEFAULT 15'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE polls ADD COLUMN reminder_2_sent INTEGER DEFAULT 0'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE polls ADD COLUMN poll_message_id TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE polls ADD COLUMN result_message_id TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE polls ADD COLUMN result_unpinned INTEGER DEFAULT 0'); } catch { /* already exists */ }
try { db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
    )
`); } catch { /* ignore */ }
try { db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
`); } catch { /* ignore */ }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)'); } catch { /* ignore */ }

// Private-message feature was removed completely - drop its leftovers from existing databases
try { db.exec('ALTER TABLE poll_responses DROP COLUMN reason'); } catch { /* already removed */ }
try { db.exec('ALTER TABLE contacts DROP COLUMN reason_dm_enabled'); } catch { /* already removed */ }
try { db.prepare("DELETE FROM app_settings WHERE key = 'reason_request_dm_enabled'").run(); } catch { /* ignore */ }

// Fix any polls stuck with invalid status from failed migration
try { db.exec("UPDATE polls SET status = 'pending' WHERE status NOT IN ('pending', 'active', 'closed') OR status IS NULL"); } catch { /* ignore */ }
try {
    db.prepare(`
        INSERT INTO app_settings (key, value)
        VALUES ('result_post_mode', 'both')
        ON CONFLICT(key) DO NOTHING
    `).run();
} catch { /* ignore */ }
try {
    db.prepare(`
        INSERT INTO app_settings (key, value)
        VALUES ('description_slow_mode_enabled', '0')
        ON CONFLICT(key) DO NOTHING
    `).run();
} catch { /* ignore */ }
try {
    db.prepare(`
        INSERT INTO app_settings (key, value)
        VALUES ('description_slow_mode_time', '04:00')
        ON CONFLICT(key) DO NOTHING
    `).run();
} catch { /* ignore */ }

// Seed initial admin user if no users exist.
// No hardcoded default password: use ADMIN_INITIAL_PASSWORD if provided, otherwise generate a
// random one and print it once, so there is never a publicly-known credential to log in with.
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
    const bcrypt = require('bcrypt');
    const crypto = require('crypto');
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const hash = bcrypt.hashSync(initialPassword, 10);
    db.prepare('INSERT INTO users (username, password_hash, must_change_password) VALUES (?, ?, 1)')
        .run('admin', hash);
    if (process.env.ADMIN_INITIAL_PASSWORD) {
        console.log('Initial admin user created (username: admin) with ADMIN_INITIAL_PASSWORD. Change it on first login.');
    } else {
        console.log('========================================================================');
        console.log('  Initial admin user created.');
        console.log('  Username: admin');
        console.log(`  Password: ${initialPassword}`);
        console.log('  You must change this on first login. This is shown only once.');
        console.log('========================================================================');
    }
}

module.exports = db;
