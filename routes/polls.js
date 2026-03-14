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
    `).get(Number(req.params.id));
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

// POST manually send poll to group
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

// POST manually post results to group (does NOT close the poll)
router.post('/:id/post-group', async (req, res) => {
    try {
        await pollManager.postGroupResults(Number(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PUT extend deadline
router.put('/:id/extend', (req, res) => {
    const minutes = Number(req.body.minutes);
    if (!minutes || minutes < 1) {
        return res.status(400).json({ error: 'Minuten müssen > 0 sein' });
    }
    try {
        const newDeadline = pollManager.extendDeadline(Number(req.params.id), minutes);
        res.json({ deadline: newDeadline });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST manually close poll
router.post('/:id/close', (req, res) => {
    try {
        pollManager.closePoll(Number(req.params.id));
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

    // Text message
    if (event === 'message' && payload) {
        const isGroup = (payload.from || '').endsWith('@g.us');
        // For group messages, sender is the person; for private, from is the person
        const phone = isGroup ? (payload.sender || payload.from) : payload.from;
        const text = payload.body;
        if (phone && text) {
            const result = pollManager.processResponse(phone, text);
            if (result) {
                console.log(`Text response from ${result.contactName}: ${result.response} (poll ${result.pollId})`);
            } else if (!isGroup) {
                // Private message that didn't match a vote → try to save as a 'Vielleicht' reason
                const reasonResult = pollManager.processReasonMessage(phone, text);
                if (reasonResult) {
                    console.log(`Reason saved from ${reasonResult.contactName} (poll ${reasonResult.pollId})`);
                }
            }
        }
    }

    // Native WhatsApp poll vote (group or individual)
    if (event === 'poll.vote' && payload) {
        // For group polls: sender is the voter's JID
        const phone = payload.sender || payload.from;
        const selectedOptions = payload.poll?.selectedOptions || payload.poll?.options || [];
        if (phone && selectedOptions.length > 0) {
            const optionName = selectedOptions[0]?.name || selectedOptions[0] || '';
            const result = pollManager.processResponse(phone, optionName);
            if (result) {
                console.log(`Poll vote from ${result.contactName}: ${result.response} (poll ${result.pollId})`);
            }
        }
    }

    // Button tap response (from sendButtons message)
    if (event === 'buttons_response' && payload) {
        const phone = payload.sender || payload.from;
        // selectedButtonId is the button id we set ('yes'/'no'/'maybe'), title is the display text
        const buttonId = payload.selectedButtonId || payload.buttonId || payload.title || '';
        if (phone && buttonId) {
            const result = pollManager.processResponse(phone, buttonId);
            if (result) {
                console.log(`Button response from ${result.contactName}: ${result.response} (poll ${result.pollId})`);
            }
        }
    }

    res.json({ ok: true });
});

module.exports = router;
