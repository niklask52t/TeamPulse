const session = require('express-session');
const db = require('../db/database');

class SQLiteSessionStore extends session.Store {
    constructor(options = {}) {
        super();
        this.ttlMs = Number(options.ttlMs || 24 * 60 * 60 * 1000);
        this.cleanupEveryMs = Number(options.cleanupEveryMs || 15 * 60 * 1000);
        this.lastCleanupAt = 0;

        this.getStmt = db.prepare('SELECT sess, expires_at FROM sessions WHERE sid = ?');
        this.setStmt = db.prepare(`
            INSERT INTO sessions (sid, sess, expires_at, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(sid) DO UPDATE SET
                sess = excluded.sess,
                expires_at = excluded.expires_at,
                updated_at = datetime('now')
        `);
        this.destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
        this.clearStmt = db.prepare('DELETE FROM sessions');
        this.lengthStmt = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?');
        this.cleanupStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
    }

    get(sid, callback) {
        try {
            this.cleanupExpired();
            const row = this.getStmt.get(sid);
            if (!row) return callback(null, null);
            if (row.expires_at <= Date.now()) {
                this.destroyStmt.run(sid);
                return callback(null, null);
            }
            return callback(null, JSON.parse(row.sess));
        } catch (err) {
            return callback(err);
        }
    }

    set(sid, sess, callback = () => {}) {
        try {
            const expiresAt = this.resolveExpiry(sess);
            this.setStmt.run(sid, JSON.stringify(sess), expiresAt);
            this.cleanupExpired();
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    destroy(sid, callback = () => {}) {
        try {
            this.destroyStmt.run(sid);
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    touch(sid, sess, callback = () => {}) {
        this.set(sid, sess, callback);
    }

    clear(callback = () => {}) {
        try {
            this.clearStmt.run();
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    length(callback) {
        try {
            this.cleanupExpired();
            const row = this.lengthStmt.get(Date.now());
            callback(null, row?.count || 0);
        } catch (err) {
            callback(err);
        }
    }

    resolveExpiry(sess) {
        const expires = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : NaN;
        if (Number.isFinite(expires) && expires > 0) return expires;
        const maxAge = Number(sess?.cookie?.maxAge);
        if (Number.isFinite(maxAge) && maxAge > 0) return Date.now() + maxAge;
        return Date.now() + this.ttlMs;
    }

    cleanupExpired(force = false) {
        const now = Date.now();
        if (!force && now - this.lastCleanupAt < this.cleanupEveryMs) return;
        this.cleanupStmt.run(now);
        this.lastCleanupAt = now;
    }
}

module.exports = SQLiteSessionStore;
