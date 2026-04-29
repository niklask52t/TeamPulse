const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../db/database');

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
    if (!user) {
        return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({
        username: user.username,
        mustChangePassword: !!user.must_change_password,
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

    const { newPassword, newUsername } = req.body;
    if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: 'Passwort muss mindestens 4 Zeichen lang sein' });
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
