const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../db/database');

const MIN_PASSWORD_LENGTH = 10;
// Constant dummy hash so a missing username still runs a bcrypt.compare of similar cost,
// closing the login timing side-channel that would otherwise reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('invalid-placeholder', 10);

router.get('/csrf', (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) {
        return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    // Regenerate the session on login to prevent session fixation (a pre-planted session ID
    // must not survive authentication). req.csrfToken() then seeds a fresh token on the new session.
    req.session.regenerate((err) => {
        if (err) {
            console.error('[ERROR] session regenerate on login:', err.message);
            return res.status(500).json({ error: 'Interner Serverfehler' });
        }
        req.session.userId = user.id;
        req.session.username = user.username;
        res.json({
            username: user.username,
            mustChangePassword: !!user.must_change_password,
            csrfToken: req.csrfToken(),
        });
    });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Nicht angemeldet' });
    }
    const user = db.prepare('SELECT id, username, must_change_password FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
        return res.status(401).json({ error: 'Nicht angemeldet' });
    }
    res.json({
        username: user.username,
        mustChangePassword: !!user.must_change_password,
    });
});

// POST /api/auth/change-password
router.post('/change-password', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Nicht angemeldet' });
    }

    const { currentPassword, newPassword, newUsername } = req.body;
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein` });
    }

    // Require the current password so a hijacked/left-open session cannot silently take over the account.
    const currentUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
    if (!currentUser || !(await bcrypt.compare(currentPassword || '', currentUser.password_hash))) {
        return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    if (newUsername && newUsername.trim()) {
        const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(newUsername.trim(), req.session.userId);
        if (existing) {
            return res.status(409).json({ error: 'Benutzername bereits vergeben' });
        }
        db.prepare('UPDATE users SET password_hash = ?, username = ?, must_change_password = 0 WHERE id = ?')
            .run(hash, newUsername.trim(), req.session.userId);
        req.session.username = newUsername.trim();
    } else {
        db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
            .run(hash, req.session.userId);
    }

    res.json({ success: true, username: req.session.username });
});

module.exports = router;
