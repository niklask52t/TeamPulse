const express = require('express');
const router = express.Router();
const db = require('../db/database');
const pollManager = require('../services/pollManager');

// GET count of active polls
router.get('/active-count', (req, res) => {
    const row = db.prepare("SELECT COUNT(*) as count FROM polls WHERE status = 'active' AND archived = 0").get();
    res.json({ count: row.count });
});

// GET all polls with responses
router.get('/', (req, res) => {
    const polls = db.prepare(`
        SELECT p.*, e.title, e.description, e.type, e.event_time
        FROM polls p JOIN events e ON p.event_id = e.id
        ORDER BY p.event_date DESC
    `).all();
    res.json(polls);
});

// GET poll details with responses
router.get('/:id', (req, res) => {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.description, e.type, e.event_time, e.recurring, e.auto_cancel, e.min_participants
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

// PUT manually set a member's response (for recovering missed votes or corrections)
router.put('/:id/response', async (req, res) => {
    const pollId = Number(req.params.id);
    const { contact_id, response } = req.body;
    const validResponses = ['yes', 'no', 'maybe', null];
    if (!contact_id || !validResponses.includes(response)) {
        return res.status(400).json({ error: 'contact_id und response (yes/no/maybe/null) erforderlich' });
    }
    const poll = db.prepare(`
        SELECT p.*, e.title, e.event_time FROM polls p JOIN events e ON p.event_id = e.id WHERE p.id = ?
    `).get(pollId);
    if (!poll) return res.status(404).json({ error: 'Umfrage nicht gefunden' });

    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact_id);
    if (!contact) return res.status(404).json({ error: 'Kontakt nicht gefunden' });

    // Ensure response row exists
    db.prepare('INSERT OR IGNORE INTO poll_responses (poll_id, contact_id) VALUES (?, ?)').run(pollId, contact_id);

    if (response) {
        db.prepare('UPDATE poll_responses SET response = ?, responded_at = datetime(\'now\') WHERE poll_id = ? AND contact_id = ?').run(response, pollId, contact_id);
    } else {
        db.prepare('UPDATE poll_responses SET response = NULL, responded_at = NULL, reason = NULL WHERE poll_id = ? AND contact_id = ?').run(pollId, contact_id);
    }

    // Send private notification to the member
    if (response && contact.phone) {
        const waha = require('../services/waha');
        const chatId = contact.phone.replace('+', '') + '@c.us';
        waha.sendAdminVoteNotification(chatId, poll.title, poll.event_date, response)
            .catch(err => console.error(`[ERROR] sendAdminVoteNotification to ${contact.name}:`, err.message));
    }

    // Trigger group description update
    const { scheduleDescriptionUpdate } = require('../services/groupDescription');
    scheduleDescriptionUpdate();

    res.json({ success: true });
});

// WAHA webhook endpoint
router.post('/webhook', async (req, res) => {
    const { event, payload } = req.body;
    const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';

    // sender can be a string JID ("49123@c.us") OR an object {id, name, ...} depending on WAHA version
    function resolvePhone(raw) {
        if (!raw) return '';
        if (typeof raw === 'object') return raw.id || raw.jid || raw.phone || '';
        return String(raw);
    }

    const senderPhone = resolvePhone(payload?.sender);
    const fromPhone   = resolvePhone(payload?.from);

    // Log every webhook so journalctl shows what WAHA is actually sending
    console.log(`[WEBHOOK] event=${event} type=${payload?.type} from=${fromPhone} sender=${senderPhone} body=${String(payload?.body || '').slice(0, 60)}`);

    // Private text messages — only for reason capture (no text-based voting)
    if (event === 'message' && payload) {
        const isGroup = fromPhone.endsWith('@g.us');

        // Ignore ALL group text messages — votes come exclusively via poll.vote
        if (!isGroup) {
            const phone = fromPhone;
            const text = payload.body;
            if (phone && text) {
                try {
                    const reasonResult = pollManager.processReasonMessage(phone, text);
                    if (reasonResult) {
                        console.log(`[REASON] Saved from ${reasonResult.contactName} (poll ${reasonResult.pollId})`);
                    }
                } catch (err) {
                    console.error(`[ERROR] processReasonMessage failed for phone=${phone}:`, err.message);
                }
            }
        }
    }

    // Native WhatsApp poll vote — only from our group
    if (event === 'poll.vote' && payload) {
        // Log individual fields to avoid truncation
        console.log(`[WEBHOOK] poll.vote keys: ${Object.keys(payload).join(', ')}`);
        console.log(`[WEBHOOK] poll.vote.vote: ${JSON.stringify(payload.vote).slice(0, 1000)}`);
        console.log(`[WEBHOOK] poll.vote.poll: ${JSON.stringify(payload.poll).slice(0, 1000)}`);
        console.log(`[WEBHOOK] poll.vote voter: ${JSON.stringify(payload.vote?.voter || payload.voter || 'none')}`);
        console.log(`[WEBHOOK] poll.vote from/sender/participant: from=${payload.from} sender=${JSON.stringify(payload.sender)} participant=${payload.participant || payload.vote?.participant}`);

        // Try all known WAHA payload shapes for voter phone
        const phone = senderPhone || fromPhone
            || resolvePhone(payload.vote?.voter)
            || resolvePhone(payload.voter)
            || resolvePhone(payload.vote?.from)
            || resolvePhone(payload.participant)
            || resolvePhone(payload.vote?.participant)
            || '';

        // Try all known shapes for selected options
        const selectedOptions = payload.vote?.selectedOptions
            || payload.selectedOptions
            || payload.poll?.selectedOptions
            || payload.poll?.options
            || payload.vote?.options
            || [];

        if (phone && selectedOptions.length > 0) {
            const optionName = selectedOptions[0]?.name || selectedOptions[0]?.value || selectedOptions[0] || '';
            try {
                const result = await pollManager.processResponse(phone, optionName);
                if (result) {
                    console.log(`[VOTE] poll.vote from ${result.contactName}: ${result.response} (poll ${result.pollId})`);
                } else {
                    console.log(`[VOTE] poll.vote unmatched — phone=${phone} option=${optionName}`);
                }
            } catch (err) {
                console.error(`[ERROR] processResponse failed for phone=${phone} option=${optionName}:`, err.message, err.stack);
            }
        } else {
            console.log(`[VOTE] poll.vote missing data — phone=${phone} options=${JSON.stringify(selectedOptions)}`);
        }
    }

    res.json({ ok: true });
});

module.exports = router;
