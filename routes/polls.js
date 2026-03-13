const express = require('express');
const router = express.Router();
const db = require('../db/database');
const pollManager = require('../services/pollManager');

// GET all polls with responses
router.get('/', (req, res) => {
    const polls = db.prepare(`
        SELECT p.*, e.title, e.type, e.event_time
        FROM polls p JOIN events e ON p.event_id = e.id
        ORDER BY p.event_date DESC
    `).all();
    res.json(polls);
});

// GET poll details with responses
router.get('/:id', (req, res) => {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.type, e.event_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(req.params.id);
    if (!poll) return res.status(404).json({ error: 'Umfrage nicht gefunden' });

    const responses = db.prepare(`
        SELECT pr.*, c.name, c.phone
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ?
        ORDER BY c.name
    `).all(poll.id);

    res.json({ ...poll, responses });
});

// POST manually create poll for event
router.post('/create', (req, res) => {
    const { event_id, event_date, deadline_minutes } = req.body;
    if (!event_id || !event_date) {
        return res.status(400).json({ error: 'Event-ID und Datum erforderlich' });
    }
    try {
        const pollId = pollManager.createPollForEvent(event_id, event_date, deadline_minutes || 120);
        res.status(201).json({ id: pollId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST manually send poll
router.post('/:id/send', async (req, res) => {
    try {
        await pollManager.sendPoll(Number(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST manually send deadline reminder
router.post('/:id/send-reminder', async (req, res) => {
    try {
        await pollManager.sendDeadlineReminder(Number(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST manually post results to group
router.post('/:id/post-group', async (req, res) => {
    try {
        await pollManager.postGroupResults(Number(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST manually send event reminders
router.post('/:id/send-event-reminder', async (req, res) => {
    try {
        await pollManager.sendEventReminders(Number(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE poll
router.delete('/:id', (req, res) => {
    const deleteAll = db.transaction((id) => {
        db.prepare('DELETE FROM poll_responses WHERE poll_id = ?').run(id);
        return db.prepare('DELETE FROM polls WHERE id = ?').run(id);
    });
    const result = deleteAll(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Umfrage nicht gefunden' });
    res.json({ success: true });
});

// WAHA webhook endpoint
router.post('/webhook', (req, res) => {
    const { event, payload } = req.body;

    // Text message response (legacy)
    if (event === 'message' && payload) {
        const phone = payload.from;
        const text = payload.body;
        if (phone && text) {
            const result = pollManager.processResponse(phone, text);
            if (result) {
                console.log(`Text response from ${result.contactName}: ${result.response} (poll ${result.pollId})`);
            }
        }
    }

    // Native WhatsApp poll vote
    if (event === 'poll.vote' && payload) {
        const phone = payload.from || payload.sender;
        const selectedOptions = payload.poll?.selectedOptions || payload.poll?.options || [];
        if (phone && selectedOptions.length > 0) {
            const optionName = selectedOptions[0]?.name || selectedOptions[0] || '';
            const result = pollManager.processResponse(phone, optionName);
            if (result) {
                console.log(`Poll vote from ${result.contactName}: ${result.response} (poll ${result.pollId})`);
            }
        }
    }

    res.json({ ok: true });
});

module.exports = router;
