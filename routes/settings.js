const express = require('express');
const router = express.Router();
const db = require('../db/database');

function getSetting(key, fallback) {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row?.value ?? fallback;
}

function setSetting(key, value) {
    db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, String(value));
}

function asBool(value, fallback = false) {
    if (value == null) return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function isValidTime(value) {
    return /^\d{2}:\d{2}$/.test(String(value || '')) && String(value).slice(0, 2) < '24' && String(value).slice(3, 5) < '60';
}

router.get('/', (req, res) => {
    res.json({
        result_post_mode: getSetting('result_post_mode', 'both'),
        description_slow_mode_enabled: asBool(getSetting('description_slow_mode_enabled', '0'), false),
        description_slow_mode_time: getSetting('description_slow_mode_time', '04:00'),
    });
});

router.put('/', (req, res) => {
    const resultPostMode = String(req.body?.result_post_mode || '').trim();
    const validResultModes = new Set(['text', 'image', 'both']);
    if (!validResultModes.has(resultPostMode)) {
        return res.status(400).json({ error: 'Ungueltiger Ergebnisversand-Modus' });
    }

    const descriptionSlowModeEnabled = asBool(req.body?.description_slow_mode_enabled, false);
    const descriptionSlowModeTime = String(req.body?.description_slow_mode_time || '04:00').trim();

    if (!isValidTime(descriptionSlowModeTime)) {
        return res.status(400).json({ error: 'Ungueltige Uhrzeit fuer den langsamen Beschreibungsmodus' });
    }

    setSetting('result_post_mode', resultPostMode);
    setSetting('description_slow_mode_enabled', descriptionSlowModeEnabled ? '1' : '0');
    setSetting('description_slow_mode_time', descriptionSlowModeTime);

    res.json({
        success: true,
        result_post_mode: resultPostMode,
        description_slow_mode_enabled: descriptionSlowModeEnabled,
        description_slow_mode_time: descriptionSlowModeTime,
    });
});

module.exports = router;
