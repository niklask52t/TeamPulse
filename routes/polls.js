const express = require('express');
const router = express.Router();
const db = require('../db/database');
const pollManager = require('../services/pollManager');

router.get('/active-count', (req, res) => {
    const row = db.prepare("SELECT COUNT(*) as count FROM polls WHERE status = 'active' AND archived = 0").get();
    res.json({ count: row.count });
});

router.get('/', (req, res) => {
    const send = () => {
        const polls = db.prepare(`
        SELECT p.*, e.title, e.description, e.type, e.event_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE NOT (
            p.status = 'pending' AND EXISTS (
                SELECT 1 FROM event_exceptions ex
                WHERE ex.event_id = p.event_id AND ex.exception_date = p.event_date
            )
        )
        ORDER BY p.event_date DESC
    `).all();
        res.json(polls);
    };

    Promise.resolve(pollManager.syncGroupParticipants())
        .catch((err) => console.error('[WARN] polls sync before GET /polls failed:', err.message))
        .finally(send);
});

router.get('/:id', (req, res) => {
    const send = () => {
        const poll = db.prepare(`
        SELECT p.*, e.title, e.description, e.type, e.event_time, e.end_time, e.meeting_time, e.recurring,
               e.auto_cancel, e.min_participants, e.poll_send_at, e.poll_send_minutes_before,
               e.poll_deadline_at, e.poll_deadline_minutes, e.event_reminder_minutes,
               e.deadline_reminder_1_minutes, e.deadline_reminder_2_minutes
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(Number(req.params.id));
        if (!poll) return res.status(404).json({ error: 'Umfrage nicht gefunden' });

        const responses = db.prepare(`
        SELECT pr.*, c.phone, COALESCE(NULLIF(c.name_override, ''), c.name) AS name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ?
        ORDER BY COALESCE(NULLIF(c.name_override, ''), c.name)
    `).all(poll.id);

        res.json({ ...poll, responses });
    };

    Promise.resolve(pollManager.syncGroupParticipants())
        .catch((err) => console.error('[WARN] polls sync before GET /polls/:id failed:', err.message))
        .finally(send);
});

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

router.post('/:id/send', async (req, res) => {
    try {
        await pollManager.sendPoll(Number(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/send-reminder', async (req, res) => {
    try {
        await pollManager.sendDeadlineReminder(Number(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/post-group', async (req, res) => {
    try {
        const poll = db.prepare('SELECT status FROM polls WHERE id = ?').get(Number(req.params.id));
        await pollManager.postGroupResults(Number(req.params.id), null, { markPosted: poll?.status !== 'active' });
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.put('/:id/extend', (req, res) => {
    const minutes = Number(req.body.minutes);
    if (!minutes || minutes < 1) {
        return res.status(400).json({ error: 'Minuten muessen > 0 sein' });
    }
    try {
        const newDeadline = pollManager.extendDeadline(Number(req.params.id), minutes);
        res.json({ deadline: newDeadline });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/resend', async (req, res) => {
    try {
        await pollManager.resendPoll(Number(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/close', async (req, res) => {
    try {
        const postResults = req.body?.postResults === true;
        const result = await pollManager.finalizeClosedPoll(Number(req.params.id), {
            postResults,
            suppressAutoPost: !postResults,
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/send-event-reminder', async (req, res) => {
    try {
        await pollManager.sendEventReminders(Number(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

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

    db.prepare('INSERT OR IGNORE INTO poll_responses (poll_id, contact_id) VALUES (?, ?)').run(pollId, contact_id);

    if (response) {
        db.prepare("UPDATE poll_responses SET response = ?, responded_at = datetime('now') WHERE poll_id = ? AND contact_id = ?").run(response, pollId, contact_id);
    } else {
        db.prepare('UPDATE poll_responses SET response = NULL, responded_at = NULL WHERE poll_id = ? AND contact_id = ?').run(pollId, contact_id);
    }

    const { scheduleImportantDescriptionUpdate } = require('../services/groupDescription');
    scheduleImportantDescriptionUpdate();

    res.json({ success: true });
});

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
}

function resolveJid(raw) {
    if (!raw) return '';
    if (typeof raw === 'object') {
        return raw.id || raw.remoteJid || raw.jid || raw._serialized || raw.phone || raw.user || raw.participant || '';
    }
    return String(raw);
}

function extractMessages(body) {
    const data = body?.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(body)) return body;
    if (Array.isArray(data?.messages)) return data.messages;
    if (Array.isArray(data?.message)) return data.message;
    if (Array.isArray(data?.updates)) return data.updates;
    if (Array.isArray(data?.messagesUpdate)) return data.messagesUpdate;
    if (Array.isArray(body?.updates)) return body.updates;
    if (Array.isArray(body?.messagesUpdate)) return body.messagesUpdate;
    if (Array.isArray(body?.messages)) return body.messages;
    if (data?.update?.key || data?.update?.message || data?.update?.pollUpdates) return [data.update];
    if (data?.key || data?.message) return [data];
    if (body?.update?.key || body?.update?.message || body?.update?.pollUpdates) return [body.update];
    if (body?.key || body?.message) return [body];
    return [];
}

function extractPollUpdate(message, body) {
    return message?.update?.pollUpdateMessage
        || message?.update?.pollUpdates
        || message?.update?.vote
        || message?.message?.pollUpdateMessage
        || message?.message?.pollCreationMessageV3?.pollUpdateMessage
        || message?.message?.pollCreationMessage?.pollUpdateMessage
        || message?.update?.pollCreationMessageV3?.pollUpdateMessage
        || message?.update?.pollCreationMessage?.pollUpdateMessage
        || message?.pollUpdateMessage
        || message?.pollUpdates
        || body?.data?.pollUpdateMessage
        || body?.data?.pollUpdates
        || body?.data?.update?.pollUpdateMessage
        || body?.data?.update?.pollUpdates
        || body?.pollUpdateMessage
        || body?.pollUpdates
        || null;
}

function collectPollMessageIds(message, pollUpdate, body) {
    const seen = new Set();
    const values = [
        pollUpdate?.pollCreationMessageKey?.id,
        pollUpdate?.pollCreationMessageKey?._serialized,
        pollUpdate?.pollCreationMessageKey?.remoteJid,
        pollUpdate?.pollCreationMessage?.key?.id,
        pollUpdate?.messageKey?.id,
        pollUpdate?.parentMessageKey?.id,
        pollUpdate?.stanzaId,
        pollUpdate?.message?.messageContextInfo?.stanzaId,
        pollUpdate?.message?.key?.id,
        message?.messageContextInfo?.stanzaId,
        message?.messageContextInfo?.quotedMessage?.key?.id,
        message?.message?.messageContextInfo?.stanzaId,
        message?.message?.messageContextInfo?.quotedMessage?.pollCreationMessage?.key?.id,
        message?.message?.pollUpdateMessage?.pollCreationMessageKey?.id,
        message?.message?.pollUpdateMessage?.message?.key?.id,
        message?.update?.pollUpdateMessage?.pollCreationMessageKey?.id,
        message?.update?.pollUpdateMessage?.message?.key?.id,
        message?.update?.pollCreationMessageKey?.id,
        message?.update?.messageKey?.id,
        message?.update?.parentMessageKey?.id,
        body?.data?.message?.pollUpdateMessage?.pollCreationMessageKey?.id,
        body?.data?.update?.pollUpdateMessage?.pollCreationMessageKey?.id,
        body?.data?.pollCreationMessageKey?.id,
        body?.data?.key?.id,
        body?.data?.messageId,
        body?.messageId,
        body?.key?.id,
    ];

    for (const value of values) {
        if (!value) continue;
        seen.add(String(value));
    }

    return [...seen];
}

function collectSelectedOptions(message, pollUpdate, body) {
    const candidates = [
        pollUpdate?.vote?.selectedOptions,
        pollUpdate?.vote?.votes,
        pollUpdate?.selectedOptions,
        pollUpdate?.pollUpdates,
        pollUpdate?.selectedOption,
        pollUpdate?.optionName,
        pollUpdate?.vote?.selectedOption,
        pollUpdate?.vote?.optionName,
        message?.pollUpdates,
        message?.update?.pollUpdates,
        message?.update?.pollUpdateMessage?.vote?.selectedOptions,
        message?.update?.pollUpdateMessage?.vote?.votes,
        message?.update?.pollUpdateMessage?.selectedOptions,
        message?.message?.pollUpdateMessage?.vote?.selectedOptions,
        message?.message?.pollUpdateMessage?.vote?.votes,
        message?.message?.pollUpdateMessage?.selectedOptions,
        body?.data?.pollUpdates,
        body?.data?.update?.pollUpdates,
        body?.data?.update?.pollUpdateMessage?.vote?.selectedOptions,
        body?.data?.message?.pollUpdateMessage?.vote?.selectedOptions,
        body?.pollUpdates,
    ];

    const options = [];
    for (const candidate of candidates) {
        for (const item of asArray(candidate)) {
            if (!item) continue;
            if (typeof item === 'string') {
                options.push(item);
                continue;
            }
            const text = item.optionName || item.name || item.value || item.option || item.text || item.displayName || item.vote;
            if (text) options.push(String(text));
        }
    }

    return options;
}

function collectParticipantCandidates(entry, body) {
    return [
        resolveJid(entry?.key?.participant),
        resolveJid(entry?.participant),
        resolveJid(entry?.update?.key?.participant),
        resolveJid(entry?.update?.participant),
        resolveJid(entry?.message?.messageContextInfo?.participant),
        resolveJid(entry?.message?.pollUpdateMessage?.senderTimestampMs ? entry?.key?.participant : ''),
        resolveJid(entry?.update?.pollUpdateMessage?.senderTimestampMs ? entry?.update?.key?.participant : ''),
        resolveJid(entry?.message?.pollUpdateMessage?.vote?.voter),
        resolveJid(entry?.message?.pollUpdateMessage?.voter),
        resolveJid(entry?.update?.pollUpdateMessage?.vote?.voter),
        resolveJid(entry?.update?.pollUpdateMessage?.voter),
        resolveJid(body?.data?.key?.participant),
        resolveJid(body?.data?.participant),
        resolveJid(body?.participant),
    ].filter(Boolean);
}

async function handleEvolutionWebhook(req, res) {
    const event = String(req.body?.event || 'MESSAGES_UPSERT')
        .trim()
        .replace(/[.\-]/g, '_')
        .toUpperCase();
    const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';

    if (event && event !== 'MESSAGES_UPSERT' && event !== 'MESSAGES_UPDATE') {
        return res.json({ ok: true });
    }

    // Cap fan-out so a single forged request cannot amplify into thousands of outbound Evolution calls
    const messages = extractMessages(req.body).slice(0, 50);
    console.log(`[WEBHOOK] evolution event=${event} messages=${messages.length}`);

    for (const entry of messages) {
        const key = entry?.key || {};
        const remoteJid = resolveJid(key.remoteJid);
        const participantCandidates = collectParticipantCandidates(entry, req.body);
        const participant = participantCandidates.find((candidate) => candidate && candidate !== remoteJid) || resolveJid(key.participant);
        const fromMe = Boolean(key.fromMe);
        const pollUpdate = extractPollUpdate(entry, req.body);

        if (!pollUpdate) {
            // Plain text messages (including private chats) are ignored - votes only come in via poll updates
            continue;
        }

        if (fromMe) {
            console.log(`[WEBHOOK] processing poll update despite fromMe=true remote=${remoteJid} participant=${participant}`);
        }

        if (GROUP_CHAT_ID && remoteJid && remoteJid !== GROUP_CHAT_ID) {
            console.log(`[VOTE] ignored poll update from other group: ${remoteJid}`);
            continue;
        }

        const phone = participant || remoteJid;
        const optionNames = collectSelectedOptions(entry, pollUpdate, req.body);
        const pollMsgIds = collectPollMessageIds(entry, pollUpdate, req.body);

        console.log(`[WEBHOOK] poll update remote=${remoteJid} participant=${participant} options=${JSON.stringify(optionNames)} pollIds=${pollMsgIds.join(',')}`);

        if (!phone || optionNames.length === 0) {
            console.log(`[VOTE] poll update missing data - phone=${phone} raw=${JSON.stringify(pollUpdate).slice(0, 1200)}`);
            continue;
        }

        try {
            const result = await pollManager.processResponse(phone, optionNames[0], pollMsgIds);
            if (result) {
                console.log(`[VOTE] counted from ${result.contactName}: ${result.response} (poll ${result.pollId})`);
            } else {
                console.log(`[VOTE] unmatched - phone=${phone} option=${optionNames[0]}`);
            }
        } catch (err) {
            console.error('[ERROR] processResponse failed for phone=%s option=%s:', phone, optionNames[0], err.stack || err.message);
        }
    }

    res.json({ ok: true });
}

router.post('/webhook/evolution', handleEvolutionWebhook);

module.exports = router;
module.exports.handleEvolutionWebhook = handleEvolutionWebhook;
