const db = require('../db/database');
const waha = require('./waha');
const { parseBerlinDateTime, TZ } = require('./timeUtils');
const { generateResultChart } = require('./chartGenerator');

const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';

// Sync group participants from WAHA into the local contacts table
async function syncGroupParticipants() {
    if (!GROUP_CHAT_ID) {
        console.warn('[WARN] GROUP_CHAT_ID not set, skipping participant sync');
        return;
    }
    try {
        const [participants, allContacts] = await Promise.all([
            waha.getGroupParticipants(GROUP_CHAT_ID),
            waha.getAllContacts(),
        ]);

        // Build phone → name map from WAHA contacts
        const nameMap = {};
        for (const c of allContacts) {
            if (!c.id) continue;
            const phone = c.id.replace('@c.us', '');
            nameMap[phone] = c.name || c.pushname || c.shortName || '';
        }

        const upsert = db.prepare(`
            INSERT INTO contacts (name, phone) VALUES (?, ?)
            ON CONFLICT(phone) DO UPDATE SET name = excluded.name WHERE excluded.name != ''
        `);

        let synced = 0;
        for (const p of participants) {
            const rawId = p.id || p.jid || '';
            if (!rawId || rawId.endsWith('@g.us')) continue; // skip sub-groups / bots without phone
            const phoneDigits = rawId.replace('@c.us', '').replace(/\D/g, '');
            if (!phoneDigits) continue;
            const phone = '+' + phoneDigits;
            const name = nameMap[phoneDigits] || nameMap[rawId.replace('@c.us', '')] || phone;
            try {
                upsert.run(name, phone);
                synced++;
            } catch (err) {
                console.error(`[WARN] syncGroupParticipants upsert failed for ${phone}:`, err.message);
            }
        }
        console.log(`[INFO] Synced ${synced} group participants to contacts`);
    } catch (err) {
        console.error('[ERROR] syncGroupParticipants:', err.message);
    }
}

function createPollForEvent(eventId, eventDate, deadlineMinutes, sendMinutesBefore) {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) throw new Error(`Event ${eventId} not found`);

    const eventDateTime = parseBerlinDateTime(eventDate, event.event_time);
    const deadline = new Date(eventDateTime.getTime() - (deadlineMinutes || 60) * 60 * 1000);
    const sendAfter = new Date(eventDateTime.getTime() - (sendMinutesBefore || event.poll_send_minutes_before || 1440) * 60 * 1000);

    const result = db.prepare(`
        INSERT INTO polls (event_id, event_date, send_after, deadline, status)
        VALUES (?, ?, ?, ?, 'pending')
    `).run(eventId, eventDate, sendAfter.toISOString(), deadline.toISOString());

    const pollId = result.lastInsertRowid;

    const contacts = db.prepare('SELECT * FROM contacts').all();
    const insertResponse = db.prepare(`
        INSERT INTO poll_responses (poll_id, contact_id) VALUES (?, ?)
    `);
    for (const contact of contacts) {
        insertResponse.run(pollId, contact.id);
    }

    return pollId;
}

async function sendPoll(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.event_time, e.meeting_time, e.type
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) throw new Error(`Poll ${pollId} not found`);
    if (poll.status === 'active') throw new Error('Umfrage wurde bereits gesendet');
    if (poll.status === 'closed') throw new Error('Umfrage ist bereits geschlossen');

    if (!GROUP_CHAT_ID) throw new Error('GROUP_CHAT_ID not configured');

    // Sync latest group members before sending
    await syncGroupParticipants();

    // Add any new contacts (synced after poll creation) as pending responses
    const existingContactIds = db.prepare(`
        SELECT contact_id FROM poll_responses WHERE poll_id = ?
    `).all(pollId).map(r => r.contact_id);

    const allContacts = db.prepare('SELECT * FROM contacts').all();
    const insertResponse = db.prepare(`
        INSERT OR IGNORE INTO poll_responses (poll_id, contact_id) VALUES (?, ?)
    `);
    for (const c of allContacts) {
        if (!existingContactIds.includes(c.id)) {
            insertResponse.run(pollId, c.id);
        }
    }

    // Send native WhatsApp poll to group
    await waha.sendPollMessage(GROUP_CHAT_ID, poll.title, poll.event_date, poll.event_time, poll.meeting_time);

    // Mark all responses as message_sent and activate poll
    db.prepare('UPDATE poll_responses SET message_sent = 1 WHERE poll_id = ?').run(pollId);
    db.prepare("UPDATE polls SET status = 'active', sent_at = datetime('now') WHERE id = ?").run(pollId);
    console.log(`[INFO] Poll ${pollId} sent to group ${GROUP_CHAT_ID}`);
}

function processResponse(phone, text) {
    const normalizedPhone = phone.replace(/@c\.us|@lid|@s\.whatsapp\.net/g, '').replace(/^\+/, '').replace(/\D/g, '');

    // Try to find existing contact by phone digits
    let contactRow = db.prepare(`
        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
    `).get(normalizedPhone);

    if (!contactRow) {
        // Auto-create contact for group members who voted but aren't in DB yet
        try {
            db.prepare(
                'INSERT OR IGNORE INTO contacts (name, phone) VALUES (?, ?)'
            ).run('+' + normalizedPhone, '+' + normalizedPhone);
            console.log(`[INFO] Auto-created contact for ${normalizedPhone}`);
        } catch { /* ignore */ }
        contactRow = db.prepare(`
            SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
        `).get(normalizedPhone);
    }

    if (!contactRow) return null;

    // Parse vote from text — only exact matches to avoid false positives from casual messages
    const lower = text.toLowerCase().trim();
    let response = null;

    // Native poll options (exact match with emoji stripped)
    const stripped = lower.replace(/[✅❌🤷\uFE0F\u200D]/g, '').trim();
    if (stripped === 'ja' || stripped === 'nein' || stripped === 'vielleicht') {
        if (stripped === 'ja') response = 'yes';
        else if (stripped === 'nein') response = 'no';
        else response = 'maybe';
    }
    // Exact short replies only (no substring matching on common words)
    else if (['ja', 'yes', 'klar', 'bin dabei', 'dabei', 'j', '1', '👍'].includes(lower)) {
        response = 'yes';
    } else if (['nein', 'no', 'kann nicht', 'ne', 'n', '2', '👎'].includes(lower)) {
        response = 'no';
    } else if (['vielleicht', 'maybe', 'vllt', 'mal sehen', 'evtl', '3', '🤷'].includes(lower)) {
        response = 'maybe';
    }

    if (!response) return null;

    // Find any active poll (don't require existing poll_response row)
    const activePoll = db.prepare(`
        SELECT p.id as poll_id, p.event_date, e.title as event_title
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.status = 'active'
        ORDER BY p.deadline ASC LIMIT 1
    `).get();

    if (!activePoll) return null;

    // Ensure response row exists, then update
    db.prepare(`
        INSERT OR IGNORE INTO poll_responses (poll_id, contact_id) VALUES (?, ?)
    `).run(activePoll.poll_id, contactRow.id);

    db.prepare(`
        UPDATE poll_responses SET response = ?, responded_at = datetime('now')
        WHERE poll_id = ? AND contact_id = ?
    `).run(response, activePoll.poll_id, contactRow.id);

    // Send follow-up asking for reason when voting "Vielleicht" or "Nein"
    if (response === 'maybe') {
        const chatId = contactRow.phone.replace('+', '') + '@c.us';
        waha.sendMaybeFollowUp(chatId, activePoll.event_title, activePoll.event_date)
            .catch(e => console.error('[ERROR] sendMaybeFollowUp:', e.message));
    } else if (response === 'no') {
        const chatId = contactRow.phone.replace('+', '') + '@c.us';
        waha.sendNoFollowUp(chatId, activePoll.event_title, activePoll.event_date)
            .catch(e => console.error('[ERROR] sendNoFollowUp:', e.message));
    }

    return { contactName: contactRow.name, response, pollId: activePoll.poll_id };
}

// Save a reason text from a contact who previously voted 'maybe' or 'no'
function processReasonMessage(phone, text) {
    const normalizedPhone = phone.replace(/@c\.us|@lid|@s\.whatsapp\.net/g, '').replace(/^\+/, '').replace(/\D/g, '');
    const contact = db.prepare(`
        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
    `).get(normalizedPhone);
    if (!contact) return null;

    // Find most recent maybe or no response without a reason (within 5 minutes)
    const pendingReason = db.prepare(`
        SELECT pr.id, p.id as poll_id, pr.response
        FROM poll_responses pr
        JOIN polls p ON pr.poll_id = p.id
        WHERE pr.contact_id = ? AND pr.response IN ('maybe', 'no') AND pr.reason IS NULL
        AND p.archived = 0
        AND pr.responded_at >= datetime('now', '-5 minutes')
        ORDER BY p.id DESC LIMIT 1
    `).get(contact.id);

    if (!pendingReason) return null;

    db.prepare('UPDATE poll_responses SET reason = ? WHERE id = ?').run(text.trim(), pendingReason.id);
    console.log(`[INFO] Reason saved for ${contact.name} (${pendingReason.response}): "${text.trim()}" (poll ${pendingReason.poll_id})`);
    return { pollId: pendingReason.poll_id, contactName: contact.name };
}

async function sendDeadlineReminder(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.event_time, e.meeting_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) return;

    // Format actual deadline time in Berlin timezone
    const deadlineTime = new Date(poll.deadline).toLocaleString('de-DE', {
        timeZone: TZ, hour: '2-digit', minute: '2-digit',
    });

    const pending = db.prepare(`
        SELECT pr.*, c.phone, c.name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ? AND pr.response IS NULL
    `).all(pollId);

    for (const r of pending) {
        try {
            const chatId = r.phone.replace('+', '') + '@c.us';
            await waha.sendReminder(chatId, poll.title, poll.event_date, poll.event_time, deadlineTime, poll.meeting_time);
        } catch (err) {
            console.error(`Failed to send reminder to ${r.name}:`, err.message);
        }
    }

    db.prepare('UPDATE polls SET reminder_sent = 1 WHERE id = ?').run(pollId);
}

// Post results to group WITHOUT closing the poll or changing status
async function postGroupResults(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.event_time, e.meeting_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) return;

    if (!GROUP_CHAT_ID) throw new Error('GROUP_CHAT_ID not configured');

    const responses = db.prepare(`
        SELECT pr.response, pr.reason, c.name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ?
    `).all(pollId);

    const yes = responses.filter(r => r.response === 'yes').map(r => r.name);
    const no = responses.filter(r => r.response === 'no').map(r => r.name);
    const maybe = responses.filter(r => r.response === 'maybe').map(r => r.name);

    await waha.postResultsToGroup(GROUP_CHAT_ID, poll.title, poll.event_date, poll.event_time, yes, no, maybe, poll.meeting_time);

    // Send chart image to group
    try {
        const pending = responses.filter(r => !r.response).length;
        const imageBuffer = generateResultChart(poll.title, poll.event_date, yes.length, no.length, maybe.length, pending);
        await waha.sendResultImage(GROUP_CHAT_ID, imageBuffer, `📊 Abstimmung: ${poll.title} – ${poll.event_date}`);
    } catch (err) {
        console.error('[ERROR] sendResultImage:', err.message);
    }

    // Only mark as posted (don't change status — use closePoll() for that)
    db.prepare('UPDATE polls SET group_posted = 1 WHERE id = ?').run(pollId);
}

// Explicitly close a poll (deadline passed or manual action)
function closePoll(pollId) {
    db.prepare("UPDATE polls SET status = 'closed' WHERE id = ? AND status = 'active'").run(pollId);
}

// Extend the deadline of an active or pending poll by N minutes
function extendDeadline(pollId, minutes) {
    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) throw new Error(`Poll ${pollId} not found`);
    if (poll.status === 'closed') throw new Error('Geschlossene Umfragen können nicht verlängert werden');

    const current = new Date(poll.deadline);
    const newDeadline = new Date(current.getTime() + minutes * 60 * 1000);
    db.prepare('UPDATE polls SET deadline = ?, reminder_sent = 0 WHERE id = ?')
        .run(newDeadline.toISOString(), pollId);
    return newDeadline.toISOString();
}

async function sendEventReminders(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.event_time, e.meeting_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) return;

    const yesResponses = db.prepare(`
        SELECT c.phone, c.name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ? AND pr.response = 'yes'
    `).all(pollId);

    for (const r of yesResponses) {
        try {
            const chatId = r.phone.replace('+', '') + '@c.us';
            await waha.sendEventReminder(chatId, poll.title, poll.event_time, poll.meeting_time);
        } catch (err) {
            console.error(`Failed to send event reminder to ${r.name}:`, err.message);
        }
    }

    db.prepare('UPDATE polls SET event_reminder_sent = 1 WHERE id = ?').run(pollId);
}

module.exports = {
    syncGroupParticipants,
    createPollForEvent,
    sendPoll,
    processResponse,
    processReasonMessage,
    sendDeadlineReminder,
    postGroupResults,
    closePoll,
    extendDeadline,
    sendEventReminders,
};
