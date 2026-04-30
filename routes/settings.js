const express = require('express');
const router = express.Router();
const db = require('../db/database');

function getSetting(key, fallback) {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row?.value || fallback;
}

router.get('/', (req, res) => {
    res.json({
        result_post_mode: getSetting('result_post_mode', 'both'),
    });
});

router.put('/', (req, res) => {
    const value = String(req.body?.result_post_mode || '').trim();
    const valid = new Set(['text', 'image', 'both']);
    if (!valid.has(value)) {
        return res.status(400).json({ error: 'Ungueltiger Ergebnisversand-Modus' });
    }

    db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('result_post_mode', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(value);

    res.json({ success: true, result_post_mode: value });
});

module.exports = router;
