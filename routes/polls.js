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

// WAHA webhook endpoint
router.post('/webhook', (req, res) => {
    const { event, payload } = req.body;

    // sender can be a string JID ("49123@c.us") OR an object {id, name, ...} depending on WAHA version
    function resolvePhone(raw) {
        if (!raw) return '';
        if (typeof raw === 'object') return raw.id || raw.jid || raw.phone || '';
        return String(raw);
    }

    const senderPhone = resolvePhone(payload?.sender);
    const fromPhone   = resolvePhone(payload?.from);

    // Log every webhook so journalctl shows what WAHA is actually sending
    console.log(`[WEBHOOK] event=${event} type=${payload?.type} from=${fromPhone} sender=${senderPhone} senderType=${typeof payload?.sender} body=${String(payload?.body || '').slice(0, 60)}`);

    // Helper: extract vote text from any button-related payload shape
    function extractButtonVote(p) {
        return p.selectedButtonId || p.buttonId
            || p.buttonResponse?.selectedButtonId || p.buttonResponse?.buttonId
            || p.body || '';
    }

    // message OR buttons_response — WAHA sends button taps as event="message" with type="buttons_response"
    if ((event === 'message' || event === 'buttons_response') && payload) {
        const isGroup = fromPhone.endsWith('@g.us');
        const phone   = isGroup ? (senderPhone || fromPhone) : fromPhone;
        const payloadType = (payload.type || '').toLowerCase();
        const isButtonResponse = event === 'buttons_response' || payloadType === 'buttons_response';

        if (isButtonResponse) {
            const vote = extractButtonVote(payload);
            if (phone && vote) {
                const result = pollManager.processResponse(phone, vote);
                if (result) {
                    console.log(`[VOTE] Button from ${result.contactName}: ${result.response} (poll ${result.pollId})`);
                } else {
                    console.log(`[VOTE] Button unmatched — phone=${phone} vote=${vote}`);
                }
            }
        } else {
            const text = payload.body;
            if (phone && text) {
                const result = pollManager.processResponse(phone, text);
                if (result) {
                    console.log(`[VOTE] Text from ${result.contactName}: ${result.response} (poll ${result.pollId})`);
                } else if (!isGroup) {
                    const reasonResult = pollManager.processReasonMessage(phone, text);
                    if (reasonResult) {
                        console.log(`[REASON] Saved from ${reasonResult.contactName} (poll ${reasonResult.pollId})`);
                    }
                } else {
                    console.log(`[VOTE] Text unmatched — phone=${phone} text=${text}`);
                }
            }
        }
    }

    // Native WhatsApp poll vote
    if (event === 'poll.vote' && payload) {
        // Log full payload for debugging (WAHA varies by version)
        console.log(`[WEBHOOK] poll.vote full payload: ${JSON.stringify(payload).slice(0, 500)}`);

        // Try all known WAHA payload shapes for voter phone
        const phone = senderPhone || fromPhone
            || resolvePhone(payload.vote?.voter)
            || resolvePhone(payload.voter)
            || resolvePhone(payload.vote?.from)
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
            const result = pollManager.processResponse(phone, optionName);
            if (result) {
                console.log(`[VOTE] poll.vote from ${result.contactName}: ${result.response} (poll ${result.pollId})`);
            } else {
                console.log(`[VOTE] poll.vote unmatched — phone=${phone} option=${optionName}`);
            }
        } else {
            console.log(`[VOTE] poll.vote missing data — phone=${phone} options=${JSON.stringify(selectedOptions)}`);
        }
    }

    res.json({ ok: true });
});

module.exports = router;
