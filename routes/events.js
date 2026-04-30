const express = require('express');
const router = express.Router();
const db = require('../db/database');
const pollManager = require('../services/pollManager');
const { updateGroupDescription } = require('../services/groupDescription');
const { berlinToday, parseBerlinDateTime, TZ } = require('../services/timeUtils');

// GET all events (with next poll date for recurring events)
router.get('/', (req, res) => {
    const events = db.prepare('SELECT * FROM events ORDER BY event_date DESC, event_time DESC').all();
    const nextPollDate = db.prepare(`
        SELECT event_date FROM polls WHERE event_id = ? AND archived = 0
        ORDER BY event_date ASC LIMIT 1
    `);
    for (const e of events) {
        if (e.recurring) {
            const next = nextPollDate.get(e.id);
            e.next_event_date = next ? next.event_date : null;
        }
    }
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
    const { title, description, type, event_date, event_time, end_time, meeting_time, recurring, recurrence_day, poll_send_minutes_before, poll_send_at, poll_deadline_minutes, poll_deadline_at, auto_cancel, min_participants, event_reminder_minutes, deadline_reminder_1_minutes, deadline_reminder_2_minutes } = req.body;

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

    if (recurring && poll_send_at) {
        return res.status(400).json({ error: 'Festes Versanddatum ist bei wiederkehrenden Events nicht möglich' });
    }

    if (recurring && poll_deadline_at) {
        return res.status(400).json({ error: 'Festes Fristdatum ist bei wiederkehrenden Events nicht möglich' });
    }

    if (meeting_time && meeting_time >= event_time) {
        return res.status(400).json({ error: 'Treffenszeit muss vor der Event-Uhrzeit liegen' });
    }
    if (end_time && end_time <= event_time) {
        return res.status(400).json({ error: 'Endzeit muss nach der Event-Uhrzeit liegen' });
    }

    const deadlineMin = poll_deadline_at ? 60 : (poll_deadline_minutes || 60);
    const sendMin = poll_send_at ? 2160 : (poll_send_minutes_before || 2160);

    const result = db.prepare(`
        INSERT INTO events (title, description, type, event_date, event_time, end_time, meeting_time, recurring, recurrence_day, poll_send_at, poll_send_minutes_before, poll_deadline_at, poll_deadline_minutes, group_post_minutes_before, auto_cancel, min_participants, event_reminder_minutes, deadline_reminder_1_minutes, deadline_reminder_2_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        title, description || null, type,
        event_date || '',
        event_time,
        end_time || null,
        meeting_time || null,
        recurring ? 1 : 0,
        recurrence_day ?? null,
        poll_send_at || null,
        sendMin,
        poll_deadline_at || null,
        deadlineMin,
        deadlineMin,
        auto_cancel ? 1 : 0,
        min_participants || 0,
        event_reminder_minutes ?? 60,
        deadline_reminder_1_minutes ?? 120,
        deadline_reminder_2_minutes ?? 15
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
            let daysAhead = (recurrence_day - todayDow + 7) % 7;
            // If same weekday (daysAhead=0), use today only if event hasn't passed yet
            if (daysAhead === 0) {
                const eventUtc = parseBerlinDateTime(todayStr, event_time);
                if (!isNaN(eventUtc.getTime()) && new Date() >= eventUtc) {
                    // Event already passed today, schedule for next week
                    daysAhead = 7;
                }
            }
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

    updateGroupDescription().catch((err) => {
        console.error('[ERROR] updateGroupDescription after event create:', err.message);
    });

    res.status(201).json(event);
});

// PUT update event
router.put('/:id', (req, res) => {
    const { title, description, type, event_date, event_time, end_time, meeting_time, recurring, recurrence_day, poll_send_minutes_before, poll_send_at, poll_deadline_minutes, poll_deadline_at, active, auto_cancel, min_participants, event_reminder_minutes, deadline_reminder_1_minutes, deadline_reminder_2_minutes } = req.body;

    if (!title || !type || !event_time) {
        return res.status(400).json({ error: 'Titel, Typ und Uhrzeit sind erforderlich' });
    }

    if (!recurring && !event_date) {
        return res.status(400).json({ error: 'Datum ist für einmalige Events erforderlich' });
    }

    if (meeting_time && meeting_time >= event_time) {
        return res.status(400).json({ error: 'Treffenszeit muss vor der Event-Uhrzeit liegen' });
    }
    if (end_time && end_time <= event_time) {
        return res.status(400).json({ error: 'Endzeit muss nach der Event-Uhrzeit liegen' });
    }

    const deadlineMin = poll_deadline_at ? 60 : (poll_deadline_minutes || 60);
    const sendMin = poll_send_at ? 2160 : (poll_send_minutes_before || 2160);

    const result = db.prepare(`
        UPDATE events SET title = ?, description = ?, type = ?, event_date = ?, event_time = ?, end_time = ?, meeting_time = ?,
        recurring = ?, recurrence_day = ?, poll_send_at = ?, poll_send_minutes_before = ?, poll_deadline_at = ?, poll_deadline_minutes = ?, group_post_minutes_before = ?, active = ?,
        auto_cancel = ?, min_participants = ?, event_reminder_minutes = ?, deadline_reminder_1_minutes = ?, deadline_reminder_2_minutes = ?
        WHERE id = ?
    `).run(
        title, description || null, type, event_date || '', event_time, end_time || null, meeting_time || null,
        recurring ? 1 : 0, recurrence_day ?? null,
        poll_send_at || null, sendMin, poll_deadline_at || null, deadlineMin, deadlineMin,
        active !== undefined ? (active ? 1 : 0) : 1,
        auto_cancel ? 1 : 0, min_participants || 0,
        event_reminder_minutes ?? 60,
        deadline_reminder_1_minutes ?? 120,
        deadline_reminder_2_minutes ?? 15,
        req.params.id
    );

    if (result.changes === 0) return res.status(404).json({ error: 'Event nicht gefunden' });
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    try {
        const updatedPolls = pollManager.refreshOpenPollScheduleForEvent(event.id);
        if (updatedPolls > 0) {
            console.log(`[INFO] Refreshed schedule for ${updatedPolls} open poll(s) after event ${event.id} update`);
        }
    } catch (err) {
        console.error('[ERROR] refreshOpenPollScheduleForEvent:', err.message);
    }
    updateGroupDescription().catch((err) => {
        console.error('[ERROR] updateGroupDescription after event update:', err.message);
    });

    res.json(event);
});

// GET exceptions for an event
router.get('/:id/exceptions', (req, res) => {
    const exceptions = db.prepare(
        'SELECT * FROM event_exceptions WHERE event_id = ? ORDER BY exception_date ASC'
    ).all(req.params.id);
    res.json(exceptions);
});

// POST add exception
router.post('/:id/exceptions', (req, res) => {
    const { exception_date, reason } = req.body;
    if (!exception_date) return res.status(400).json({ error: 'Datum ist erforderlich' });
    try {
        const result = db.prepare(
            'INSERT INTO event_exceptions (event_id, exception_date, reason) VALUES (?, ?, ?)'
        ).run(req.params.id, exception_date, reason || null);
        // Delete any existing pending poll for this date
        db.prepare(
            "DELETE FROM polls WHERE event_id = ? AND event_date = ? AND status = 'pending'"
        ).run(req.params.id, exception_date);
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (err) {
        if (err.message?.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Ausnahme für dieses Datum existiert bereits' });
        }
        throw err;
    }
});

// DELETE exception
router.delete('/:id/exceptions/:exceptionId', (req, res) => {
    const result = db.prepare(
        'DELETE FROM event_exceptions WHERE id = ? AND event_id = ?'
    ).run(req.params.exceptionId, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Ausnahme nicht gefunden' });
    res.json({ success: true });
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
