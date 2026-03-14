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

function createPollForEvent(eventId, eventDate, deadlineMinutes) {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) throw new Error(`Event ${eventId} not found`);

    const eventDateTime = parseBerlinDateTime(eventDate, event.event_time);
    const deadline = new Date(eventDateTime.getTime() - deadlineMinutes * 60 * 1000);

    const result = db.prepare(`
        INSERT INTO polls (event_id, event_date, deadline, status)
        VALUES (?, ?, ?, 'pending')
    `).run(eventId, eventDate, deadline.toISOString());

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
        SELECT p.*, e.title, e.event_time, e.type
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) throw new Error(`Poll ${pollId} not found`);

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

    // Send ONE poll to the group chat
    await waha.sendPollMessage(GROUP_CHAT_ID, poll.title, poll.event_date, poll.event_time);

    // Mark all responses as message_sent and activate poll
    db.prepare('UPDATE poll_responses SET message_sent = 1 WHERE poll_id = ?').run(pollId);
    db.prepare("UPDATE polls SET status = 'active', sent_at = datetime('now') WHERE id = ?").run(pollId);
    console.log(`[INFO] Poll ${pollId} sent to group ${GROUP_CHAT_ID}`);
}

function processResponse(phone, text) {
    const normalizedPhone = phone.replace('@c.us', '').replace(/^\+/, '').replace(/\D/g, '');
    const contact = db.prepare(`
        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
    `).get(normalizedPhone);

    if (!contact) {
        // Auto-create contact for group members who voted but aren't in DB yet
        try {
            const insertResult = db.prepare(
                'INSERT OR IGNORE INTO contacts (name, phone) VALUES (?, ?)'
            ).run(phone.replace('@c.us', ''), '+' + normalizedPhone);
            if (insertResult.changes > 0) {
                console.log(`[INFO] Auto-created contact for ${normalizedPhone}`);
            }
        } catch { /* ignore */ }
    }

    const contactRow = db.prepare(`
        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
    `).get(normalizedPhone);

    if (!contactRow) return null;

    // Find the most recent ACTIVE poll (voted via group poll → match by deadline proximity)
    const activePoll = db.prepare(`
        SELECT pr.id as response_id, p.id as poll_id, p.event_date, e.title as event_title
        FROM poll_responses pr
        JOIN polls p ON pr.poll_id = p.id
        JOIN events e ON p.event_id = e.id
        WHERE pr.contact_id = ? AND p.status = 'active'
        ORDER BY p.deadline ASC LIMIT 1
    `).get(contactRow.id);

    if (!activePoll) return null;

    const lower = text.toLowerCase().trim();
    let response = null;

    // Native poll options (exact match with emoji stripped)
    const stripped = lower.replace(/[✅❌🤷\uFE0F\u200D]/g, '').trim();
    if (stripped === 'ja' || stripped === 'nein' || stripped === 'vielleicht') {
        if (stripped === 'ja') response = 'yes';
        else if (stripped === 'nein') response = 'no';
        else response = 'maybe';
    }
    // Text keywords (exact word match for short ones)
    else if (['ja', 'yes', 'klar', 'bin dabei', 'dabei'].some(k => lower.includes(k)) || lower === 'j' || lower === '1' || lower === '👍') {
        response = 'yes';
    } else if (['nein', 'no', 'kann nicht'].some(k => lower.includes(k)) || lower === 'n' || lower === 'ne' || lower === '2' || lower === '👎') {
        response = 'no';
    } else if (['vielleicht', 'maybe', 'vllt', 'mal sehen', 'evtl'].some(k => lower.includes(k)) || lower === '3' || lower === '🤷') {
        response = 'maybe';
    }

    if (!response) return null;

    // Upsert: insert response row if not exists, then update
    db.prepare(`
        INSERT OR IGNORE INTO poll_responses (poll_id, contact_id) VALUES (?, ?)
    `).run(activePoll.poll_id, contactRow.id);

    db.prepare(`
        UPDATE poll_responses SET response = ?, responded_at = datetime('now')
        WHERE poll_id = ? AND contact_id = ?
    `).run(response, activePoll.poll_id, contactRow.id);

    // Send follow-up asking for reason when voting "Vielleicht"
    if (response === 'maybe') {
        const chatId = contactRow.phone.replace('+', '') + '@c.us';
        waha.sendMaybeFollowUp(chatId, activePoll.event_title, activePoll.event_date)
            .catch(e => console.error('[ERROR] sendMaybeFollowUp:', e.message));
    }

    return { contactName: contactRow.name, response, pollId: activePoll.poll_id };
}

// Save a reason text from a contact who previously voted 'maybe'
function processReasonMessage(phone, text) {
    const normalizedPhone = phone.replace('@c.us', '').replace(/^\+/, '').replace(/\D/g, '');
    const contact = db.prepare(`
        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
    `).get(normalizedPhone);
    if (!contact) return null;

    // Find most recent maybe response without a reason on a non-archived poll
    const maybeResponse = db.prepare(`
        SELECT pr.id, p.id as poll_id
        FROM poll_responses pr
        JOIN polls p ON pr.poll_id = p.id
        WHERE pr.contact_id = ? AND pr.response = 'maybe' AND pr.reason IS NULL
        AND p.archived = 0
        ORDER BY p.id DESC LIMIT 1
    `).get(contact.id);

    if (!maybeResponse) return null;

    db.prepare('UPDATE poll_responses SET reason = ? WHERE id = ?').run(text.trim(), maybeResponse.id);
    console.log(`[INFO] Reason saved for ${contact.name}: "${text.trim()}" (poll ${maybeResponse.poll_id})`);
    return { pollId: maybeResponse.poll_id, contactName: contact.name };
}

async function sendDeadlineReminder(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.event_time
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
            await waha.sendReminderWithButtons(chatId, poll.title, poll.event_date, poll.event_time, deadlineTime);
        } catch (err) {
            console.error(`Failed to send reminder to ${r.name}:`, err.message);
        }
    }

    db.prepare('UPDATE polls SET reminder_sent = 1 WHERE id = ?').run(pollId);
}

// Post results to group WITHOUT closing the poll or changing status
async function postGroupResults(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.event_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) return;

    if (!GROUP_CHAT_ID) throw new Error('GROUP_CHAT_ID not configured');

    const responses = db.prepare(`
        SELECT pr.response, c.name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ?
    `).all(pollId);

    const yes = responses.filter(r => r.response === 'yes').map(r => r.name);
    const no = responses.filter(r => r.response === 'no').map(r => r.name);
    const maybe = responses.filter(r => r.response === 'maybe').map(r => r.name);

    await waha.postResultsToGroup(GROUP_CHAT_ID, poll.title, poll.event_date, poll.event_time, yes, no, maybe);

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
        SELECT p.*, e.title, e.event_time
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
            await waha.sendEventReminder(chatId, poll.title, poll.event_time);
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
