const express = require('express');
const router = express.Router();
const db = require('../db/database');
const pollManager = require('../services/pollManager');

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
    const { title, type, event_date, event_time, recurring, recurrence_day, poll_deadline_minutes, group_post_minutes_before } = req.body;

    if (!title || !type || !event_time) {
        return res.status(400).json({ error: 'Titel, Typ und Uhrzeit sind erforderlich' });
    }

    const result = db.prepare(`
        INSERT INTO events (title, type, event_date, event_time, recurring, recurrence_day, poll_deadline_minutes, group_post_minutes_before)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        title, type,
        event_date || '',
        event_time,
        recurring ? 1 : 0,
        recurrence_day ?? null,
        poll_deadline_minutes || 120,
        group_post_minutes_before || 60
    );

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);

    // For non-recurring events, create poll immediately
    if (!recurring && event_date) {
        const pollId = pollManager.createPollForEvent(event.id, event_date, poll_deadline_minutes || 120);
        event.pollId = pollId;
    }

    res.status(201).json(event);
});

// PUT update event
router.put('/:id', (req, res) => {
    const { title, type, event_date, event_time, recurring, recurrence_day, poll_deadline_minutes, group_post_minutes_before, active } = req.body;

    const result = db.prepare(`
        UPDATE events SET title = ?, type = ?, event_date = ?, event_time = ?,
        recurring = ?, recurrence_day = ?, poll_deadline_minutes = ?, group_post_minutes_before = ?, active = ?
        WHERE id = ?
    `).run(
        title, type, event_date || '', event_time,
        recurring ? 1 : 0, recurrence_day ?? null,
        poll_deadline_minutes || 120, group_post_minutes_before || 60,
        active !== undefined ? (active ? 1 : 0) : 1,
        req.params.id
    );

    if (result.changes === 0) return res.status(404).json({ error: 'Event nicht gefunden' });
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    res.json(event);
});

// DELETE event
router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Event nicht gefunden' });
    res.json({ success: true });
});

module.exports = router;
