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
try { db.exec('ALTER TABLE poll_responses ADD COLUMN reason TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN meeting_time TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE events ADD COLUMN poll_send_minutes_before INTEGER DEFAULT 1440'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE polls ADD COLUMN send_after TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE contacts ADD COLUMN lid TEXT'); } catch { /* already exists */ }
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

// Migrate polls CHECK constraint to include 'sending' status
try {
    const checkInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='polls'").get();
    if (checkInfo && checkInfo.sql && !checkInfo.sql.includes("'sending'")) {
        db.exec(`
            CREATE TABLE polls_new (
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
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'active', 'closed')),
                poll_message_id TEXT,
                result_message_id TEXT,
                result_unpinned INTEGER DEFAULT 0,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
            );
            INSERT INTO polls_new SELECT id, event_id, event_date, sent_at, send_after, deadline,
                reminder_sent, reminder_2_sent, group_posted, event_reminder_sent, archived, status,
                poll_message_id, result_message_id, result_unpinned FROM polls;
            DROP TABLE polls;
            ALTER TABLE polls_new RENAME TO polls;
        `);
        console.log('Migrated polls CHECK constraint to include sending status');
    }
} catch (err) { console.error('[WARN] polls CHECK migration:', err.message); }

// Seed default admin user if no users exist
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
    const bcrypt = require('bcrypt');
    const hash = bcrypt.hashSync('admin', 10);
    db.prepare('INSERT INTO users (username, password_hash, must_change_password) VALUES (?, ?, 1)')
        .run('admin', hash);
    console.log('Default admin user created (admin/admin)');
}

module.exports = db;
