const express = require('express');
const router = express.Router();
const db = require('../db/database');
const pollManager = require('../services/pollManager');
const { berlinToday, TZ } = require('../services/timeUtils');

// GET all events
router.get('/', (req, res) => {
    const events = db.prepare('SELECT * FROM events ORDER BY event_date DESC, event_time DESC').all();
    res.json(events);
});

// GET single event with polls
router.get('/:id', (req, res) => {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event nicht gefunden' });

    const polls = db.prepare('SELECT * FROM polls WHERE event_id = ? ORDER BY event_date DESC').all(event.id);
    res.json({ ...event, polls });
});

// POST create event
router.post('/', (req, res) => {
    const { title, type, event_date, event_time, meeting_time, recurring, recurrence_day, poll_send_minutes_before, poll_deadline_minutes } = req.body;

    if (!title || !type || !event_time) {
        return res.status(400).json({ error: 'Titel, Typ und Uhrzeit sind erforderlich' });
    }

    if (!recurring && !event_date) {
        return res.status(400).json({ error: 'Datum ist für einmalige Events erforderlich' });
    }

    if (!recurring && event_date) {
        const today = berlinToday();
        if (event_date < today) {
            return res.status(400).json({ error: 'Datum darf nicht in der Vergangenheit liegen' });
        }
    }

    const deadlineMin = poll_deadline_minutes || 60;
    const sendMin = poll_send_minutes_before || 1440;

    const result = db.prepare(`
        INSERT INTO events (title, type, event_date, event_time, meeting_time, recurring, recurrence_day, poll_send_minutes_before, poll_deadline_minutes, group_post_minutes_before)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        title, type,
        event_date || '',
        event_time,
        meeting_time || null,
        recurring ? 1 : 0,
        recurrence_day ?? null,
        sendMin,
        deadlineMin,
        deadlineMin
    );

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);

    // For non-recurring events, create poll immediately
    if (!recurring && event_date) {
        try {
            const pollId = pollManager.createPollForEvent(event.id, event_date, deadlineMin, sendMin);
            event.pollId = pollId;
        } catch (err) {
            console.error('[ERROR] createPollForEvent:', err);
        }
    }

    // For recurring events, create the first poll for the next occurrence immediately
    if (recurring && recurrence_day != null) {
        try {
            const todayStr = berlinToday();
            const todayDow = new Date(new Date().toLocaleString('sv-SE', { timeZone: TZ })).getDay();
            const daysAhead = (recurrence_day - todayDow + 7) % 7 || 7;
            const d = new Date(todayStr + 'T12:00:00Z');
            d.setUTCDate(d.getUTCDate() + daysAhead);
            const nextDate = d.toISOString().split('T')[0];
            const pollId = pollManager.createPollForEvent(event.id, nextDate, deadlineMin, sendMin);
            event.pollId = pollId;
            console.log(`[INFO] Created first recurring poll ${pollId} for ${event.title} on ${nextDate}`);
        } catch (err) {
            console.error('[ERROR] createPollForEvent (recurring first):', err);
        }
    }

    res.status(201).json(event);
});

// PUT update event
router.put('/:id', (req, res) => {
    const { title, type, event_date, event_time, meeting_time, recurring, recurrence_day, poll_send_minutes_before, poll_deadline_minutes, active } = req.body;

    if (!title || !type || !event_time) {
        return res.status(400).json({ error: 'Titel, Typ und Uhrzeit sind erforderlich' });
    }

    if (!recurring && !event_date) {
        return res.status(400).json({ error: 'Datum ist für einmalige Events erforderlich' });
    }

    const deadlineMin = poll_deadline_minutes || 60;
    const sendMin = poll_send_minutes_before || 1440;

    const result = db.prepare(`
        UPDATE events SET title = ?, type = ?, event_date = ?, event_time = ?, meeting_time = ?,
        recurring = ?, recurrence_day = ?, poll_send_minutes_before = ?, poll_deadline_minutes = ?, group_post_minutes_before = ?, active = ?
        WHERE id = ?
    `).run(
        title, type, event_date || '', event_time, meeting_time || null,
        recurring ? 1 : 0, recurrence_day ?? null,
        sendMin, deadlineMin, deadlineMin,
        active !== undefined ? (active ? 1 : 0) : 1,
        req.params.id
    );

    if (result.changes === 0) return res.status(404).json({ error: 'Event nicht gefunden' });
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    res.json(event);
});

// DELETE event (explicit cascade for compatibility with older DBs)
router.delete('/:id', (req, res) => {
    const deleteAll = db.transaction((id) => {
        db.prepare('DELETE FROM poll_responses WHERE poll_id IN (SELECT id FROM polls WHERE event_id = ?)').run(id);
        db.prepare('DELETE FROM polls WHERE event_id = ?').run(id);
        return db.prepare('DELETE FROM events WHERE id = ?').run(id);
    });
    const result = deleteAll(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Event nicht gefunden' });
    res.json({ success: true });
});

module.exports = router;
