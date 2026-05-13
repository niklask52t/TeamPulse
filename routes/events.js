const express = require('express');
const router = express.Router();
const db = require('../db/database');
const pollManager = require('../services/pollManager');
const { scheduleDescriptionUpdate } = require('../services/groupDescription');
const { berlinToday, parseBerlinDateTime, TZ } = require('../services/timeUtils');
const evolution = require('../services/evolution');
const SKIP_NEXT_POLL_REASON = 'Nächste Umfrage ausgesetzt';

async function deleteOpenPollsForEvent(eventId) {
    const openPolls = db.prepare(`
        SELECT id, poll_message_id, result_message_id
        FROM polls
        WHERE event_id = ? AND archived = 0 AND status IN ('pending', 'active')
    `).all(eventId);

    const groupChatId = process.env.GROUP_CHAT_ID || '';
    for (const poll of openPolls) {
        if (groupChatId && poll.poll_message_id) {
            evolution.unpinMessage(groupChatId, poll.poll_message_id).catch(() => {});
        }
        if (groupChatId && poll.result_message_id) {
            evolution.unpinMessage(groupChatId, poll.result_message_id).catch(() => {});
        }
    }

    if (openPolls.length > 0) {
        db.prepare('DELETE FROM poll_responses WHERE poll_id IN (SELECT id FROM polls WHERE event_id = ? AND archived = 0 AND status IN (\'pending\', \'active\'))').run(eventId);
        db.prepare("DELETE FROM polls WHERE event_id = ? AND archived = 0 AND status IN ('pending', 'active')").run(eventId);
        await pollManager.reconcilePinnedActivePoll();
    }

    return openPolls.length;
}

function ensureOpenPollForEvent(event) {
    if (!event?.active) return null;

    const existingOpenPoll = db.prepare(`
        SELECT id FROM polls
        WHERE event_id = ? AND archived = 0 AND status IN ('pending', 'active')
        ORDER BY id DESC LIMIT 1
    `).get(event.id);
    if (existingOpenPoll) return existingOpenPoll.id;

    const deadlineMin = event.poll_deadline_at ? 60 : (event.poll_deadline_minutes || 60);
    const sendMin = event.poll_send_at ? 2160 : (event.poll_send_minutes_before || 2160);
    const nextDate = findNextSchedulableDate(event);
    return nextDate ? pollManager.createPollForEvent(event.id, nextDate, deadlineMin, sendMin) : null;
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

function findNextSchedulableDate(event) {
    if (!event?.active) return null;

    if (!event.recurring) {
        if (!event.event_date) return null;
        const eventUtc = parseBerlinDateTime(event.event_date, event.event_time);
        if (isNaN(eventUtc.getTime()) || new Date() >= eventUtc) return null;

        const blocked = db.prepare(
            'SELECT id FROM event_exceptions WHERE event_id = ? AND exception_date = ?'
        ).get(event.id, event.event_date);
        return blocked ? null : event.event_date;
    }

    if (event.recurrence_day == null) return null;

    const todayStr = berlinToday();
    const todayDow = new Date(new Date().toLocaleString('sv-SE', { timeZone: TZ })).getDay();
    let daysAhead = (event.recurrence_day - todayDow + 7) % 7;
    if (daysAhead === 0) {
        const eventUtc = parseBerlinDateTime(todayStr, event.event_time);
        if (!isNaN(eventUtc.getTime()) && new Date() >= eventUtc) {
            daysAhead = 7;
        }
    }

    for (let attempt = 0; attempt < 52; attempt++) {
        const candidateDate = addDays(todayStr, daysAhead + (attempt * 7));
        const blocked = db.prepare(
            'SELECT id FROM event_exceptions WHERE event_id = ? AND exception_date = ?'
        ).get(event.id, candidateDate);
        if (!blocked) return candidateDate;
    }

    return null;
}

function applySkipNextPoll(eventId) {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event || !event.active) return null;

    const skipDate = findNextSchedulableDate(event);
    if (!skipDate) return null;

    db.prepare(`
        INSERT OR IGNORE INTO event_exceptions (event_id, exception_date, reason)
        VALUES (?, ?, ?)
    `).run(eventId, skipDate, SKIP_NEXT_POLL_REASON);

    db.prepare('DELETE FROM poll_responses WHERE poll_id IN (SELECT id FROM polls WHERE event_id = ? AND event_date = ? AND status = \'pending\' AND archived = 0)')
        .run(eventId, skipDate);
    db.prepare("DELETE FROM polls WHERE event_id = ? AND event_date = ? AND status = 'pending' AND archived = 0")
        .run(eventId, skipDate);

    return skipDate;
}

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
    const { title, description, type, event_date, event_time, end_time, meeting_time, recurring, recurrence_day, poll_send_minutes_before, poll_send_at, poll_deadline_minutes, poll_deadline_at, active, auto_cancel, min_participants, event_reminder_minutes, deadline_reminder_1_minutes, deadline_reminder_2_minutes, skip_next_poll } = req.body;

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
        INSERT INTO events (title, description, type, event_date, event_time, end_time, meeting_time, recurring, recurrence_day, poll_send_at, poll_send_minutes_before, poll_deadline_at, poll_deadline_minutes, group_post_minutes_before, active, auto_cancel, min_participants, event_reminder_minutes, deadline_reminder_1_minutes, deadline_reminder_2_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        active !== undefined ? (active ? 1 : 0) : 1,
        auto_cancel ? 1 : 0,
        min_participants || 0,
        event_reminder_minutes ?? 60,
        deadline_reminder_1_minutes ?? 120,
        deadline_reminder_2_minutes ?? 15
    );

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);

    let skippedPollDate = null;
    if (skip_next_poll) {
        skippedPollDate = applySkipNextPoll(event.id);
        if (skippedPollDate) {
            event.skipped_poll_date = skippedPollDate;
            console.log(`[INFO] Next poll skipped for event ${event.id} on ${skippedPollDate}`);
        }
    }

    // For non-recurring events, create poll immediately
    if ((active !== false) && !recurring && event_date && skippedPollDate !== event_date) {
        try {
            const pollId = pollManager.createPollForEvent(event.id, event_date, deadlineMin, sendMin);
            event.pollId = pollId;
        } catch (err) {
            console.error('[ERROR] createPollForEvent:', err);
        }
    }

    // For recurring events, create the first poll for the next occurrence immediately
    if ((active !== false) && recurring && recurrence_day != null && !skippedPollDate) {
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

    scheduleDescriptionUpdate();

    res.status(201).json(event);
});

// PUT update event
router.put('/:id', async (req, res) => {
    const { title, description, type, event_date, event_time, end_time, meeting_time, recurring, recurrence_day, poll_send_minutes_before, poll_send_at, poll_deadline_minutes, poll_deadline_at, active, auto_cancel, min_participants, event_reminder_minutes, deadline_reminder_1_minutes, deadline_reminder_2_minutes, skip_next_poll } = req.body;

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
    if (skip_next_poll) {
        const skippedPollDate = applySkipNextPoll(event.id);
        if (skippedPollDate) {
            event.skipped_poll_date = skippedPollDate;
            console.log(`[INFO] Next poll skipped for event ${event.id} on ${skippedPollDate}`);
        }
    }
    if (!event.active) {
        try {
            const removed = await deleteOpenPollsForEvent(event.id);
            if (removed > 0) {
                console.log(`[INFO] Removed ${removed} open poll(s) after deactivating event ${event.id}`);
            }
        } catch (err) {
            console.error('[ERROR] deleteOpenPollsForEvent:', err.message);
        }
    } else {
        try {
            const ensuredPollId = ensureOpenPollForEvent(event);
            if (ensuredPollId) {
                console.log(`[INFO] Ensured open poll ${ensuredPollId} for active event ${event.id}`);
            }
        } catch (err) {
            console.error('[ERROR] ensureOpenPollForEvent:', err.message);
        }
    }
    try {
        const updatedPolls = pollManager.refreshOpenPollScheduleForEvent(event.id);
        if (updatedPolls > 0) {
            console.log(`[INFO] Refreshed schedule for ${updatedPolls} open poll(s) after event ${event.id} update`);
        }
    } catch (err) {
        console.error('[ERROR] refreshOpenPollScheduleForEvent:', err.message);
    }
    await pollManager.reconcilePinnedActivePoll();
    scheduleDescriptionUpdate();

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

    const event = db.prepare('SELECT id, recurring, recurrence_day, event_date FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event nicht gefunden' });

    if (event.recurring) {
        const selectedDay = new Date(exception_date + 'T12:00:00Z').getUTCDay();
        if (selectedDay !== Number(event.recurrence_day)) {
            const dayLabels = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
            return res.status(400).json({ error: `Für dieses wiederkehrende Event können nur Termine am ${dayLabels[Number(event.recurrence_day)]} ausgesetzt werden` });
        }
    } else if (event.event_date && event.event_date !== exception_date) {
        return res.status(400).json({ error: 'Für einmalige Events kann nur das tatsächliche Event-Datum ausgesetzt werden' });
    }

    try {
        const result = db.prepare(
            'INSERT INTO event_exceptions (event_id, exception_date, reason) VALUES (?, ?, ?)'
        ).run(req.params.id, exception_date, reason || null);
        // Delete any existing pending poll for this date
        db.prepare(
            "DELETE FROM polls WHERE event_id = ? AND event_date = ? AND status = 'pending'"
        ).run(req.params.id, exception_date);
        scheduleDescriptionUpdate();
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
    scheduleDescriptionUpdate();
    res.json({ success: true });
});

// DELETE event (explicit cascade for compatibility with older DBs)
router.delete('/:id', async (req, res) => {
    const deleteAll = db.transaction((id) => {
        db.prepare('DELETE FROM poll_responses WHERE poll_id IN (SELECT id FROM polls WHERE event_id = ?)').run(id);
        db.prepare('DELETE FROM polls WHERE event_id = ?').run(id);
        return db.prepare('DELETE FROM events WHERE id = ?').run(id);
    });
    const result = deleteAll(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Event nicht gefunden' });
    await pollManager.reconcilePinnedActivePoll();
    scheduleDescriptionUpdate();
    res.json({ success: true });
});

module.exports = router;
