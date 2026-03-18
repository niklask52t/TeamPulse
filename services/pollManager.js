const db = require('../db/database');
const waha = require('./waha');
const { parseBerlinDateTime, TZ } = require('./timeUtils');
const { generateResultChart } = require('./chartGenerator');

const { scheduleDescriptionUpdate } = require('./groupDescription');
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';

// Extract message ID string from WAHA response (handles various response shapes)
// Always returns a string or null — never undefined or objects
function extractMessageId(result) {
    if (!result) return null;
    const raw = result.id || result.key?.id || null;
    if (raw == null) return null;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object') return String(raw._serialized || raw.id || JSON.stringify(raw));
    return String(raw);
}

// In-memory lock to prevent duplicate sends from overlapping scheduler ticks
const sendingPolls = new Set();

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

        // Build phone → name map and phone → lid map from WAHA contacts
        const nameMap = {};
        const lidMap = {}; // phone digits → lid digits
        for (const c of allContacts) {
            if (!c.id) continue;
            const phone = c.id.replace('@c.us', '');
            nameMap[phone] = c.name || c.pushname || c.shortName || '';
            // WAHA may provide lid in various fields
            const lid = c.lid || c.lidJid || c.linkedDeviceId || '';
            if (lid) {
                const lidDigits = String(lid).replace(/@lid/g, '').replace(/\D/g, '');
                if (lidDigits) lidMap[phone] = lidDigits;
            }
        }

        const upsert = db.prepare(`
            INSERT INTO contacts (name, phone) VALUES (?, ?)
            ON CONFLICT(phone) DO UPDATE SET name = excluded.name WHERE excluded.name != ''
        `);
        const updateLid = db.prepare('UPDATE contacts SET lid = ? WHERE phone = ?');

        // Log first participant's full structure for debugging
        if (participants.length > 0) {
            console.log(`[SYNC] Participant[0] full keys: ${Object.keys(participants[0]).join(', ')}`);
            console.log(`[SYNC] Participant[0] full data: ${JSON.stringify(participants[0]).slice(0, 500)}`);
        }
        if (allContacts.length > 0) {
            console.log(`[SYNC] Contact[0] full keys: ${Object.keys(allContacts[0]).join(', ')}`);
            console.log(`[SYNC] Contact[0] full data: ${JSON.stringify(allContacts[0]).slice(0, 500)}`);
        }

        let synced = 0;
        for (const p of participants) {
            const rawId = p.id || p.jid || '';
            if (!rawId || rawId.endsWith('@g.us')) continue; // skip sub-groups / bots without phone
            // Skip LID-only participants (no real phone number)
            if (rawId.endsWith('@lid')) continue;
            const phoneDigits = rawId.replace('@c.us', '').replace(/\D/g, '');
            if (!phoneDigits) continue;
            const phone = '+' + phoneDigits;
            const name = nameMap[phoneDigits] || nameMap[rawId.replace('@c.us', '')] || phone;
            try {
                upsert.run(name, phone);
                // Store LID from participant data or contact list
                const lid = p.lid || p.lidJid || '';
                const lidDigits = lid ? String(lid).replace(/@lid/g, '').replace(/\D/g, '') : (lidMap[phoneDigits] || '');
                if (lidDigits) {
                    updateLid.run(lidDigits, phone);
                }
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

    // Fixed deadline date takes precedence over minutes-before
    let deadline;
    if (event.poll_deadline_at) {
        const [dlDate, dlTime] = event.poll_deadline_at.split('T');
        deadline = parseBerlinDateTime(dlDate, dlTime || '00:00');
    } else {
        deadline = new Date(eventDateTime.getTime() - (deadlineMinutes || 60) * 60 * 1000);
    }

    // Fixed send date takes precedence over minutes-before
    let sendAfter;
    if (event.poll_send_at) {
        const [sendDate, sendTime] = event.poll_send_at.split('T');
        sendAfter = parseBerlinDateTime(sendDate, sendTime || '00:00');
    } else {
        sendAfter = new Date(eventDateTime.getTime() - (sendMinutesBefore || event.poll_send_minutes_before || 1440) * 60 * 1000);
    }

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
        SELECT p.*, e.title, e.description, e.event_time, e.end_time, e.meeting_time, e.type
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) throw new Error(`Poll ${pollId} not found`);
    if (poll.status === 'active') throw new Error('Umfrage wurde bereits gesendet');
    if (poll.status === 'closed') throw new Error('Umfrage ist bereits geschlossen');
    if (sendingPolls.has(pollId)) throw new Error('Umfrage wird gerade gesendet');

    if (!GROUP_CHAT_ID) throw new Error('GROUP_CHAT_ID not configured');

    // Lock in memory to prevent duplicate sends from overlapping scheduler ticks
    sendingPolls.add(pollId);

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
    let pollResult;
    try {
        pollResult = await waha.sendPollMessage(GROUP_CHAT_ID, poll.title, poll.event_date, poll.event_time, poll.end_time, poll.meeting_time, poll.description);
    } catch (err) {
        // Release lock so scheduler can retry next minute
        sendingPolls.delete(pollId);
        throw err;
    }

    // Save message ID and pin the poll
    console.log(`[DEBUG] sendPoll WAHA response: ${JSON.stringify(pollResult).slice(0, 500)}`);
    const pollMessageId = extractMessageId(pollResult);
    db.prepare('UPDATE poll_responses SET message_sent = 1 WHERE poll_id = ?').run(pollId);
    db.prepare("UPDATE polls SET status = 'active', sent_at = datetime('now'), poll_message_id = ? WHERE id = ?").run(pollMessageId, pollId);

    if (pollMessageId) {
        waha.pinMessage(GROUP_CHAT_ID, pollMessageId)
            .catch(e => console.error('[ERROR] pinMessage poll:', e.message));
    }
    sendingPolls.delete(pollId);
    console.log(`[INFO] Poll ${pollId} sent to group ${GROUP_CHAT_ID}`);
    scheduleDescriptionUpdate();
}

async function processResponse(phone, text, pollMessageId) {
    const isLid = phone.includes('@lid');
    const normalizedPhone = phone.replace(/@c\.us|@lid|@s\.whatsapp\.net/g, '').replace(/^\+/, '').replace(/\D/g, '');

    // Try to find existing contact by phone digits
    let contactRow = db.prepare(`
        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
    `).get(normalizedPhone);

    // If not found by phone, try matching by LID (WhatsApp Linked ID)
    if (!contactRow && isLid) {
        contactRow = db.prepare('SELECT * FROM contacts WHERE lid = ?').get(normalizedPhone);
        if (contactRow) {
            console.log(`[INFO] Matched LID ${normalizedPhone} to contact ${contactRow.name} (${contactRow.phone}) via DB`);
        }
    }

    // If still not found and it's a LID, try resolving via WAHA API
    if (!contactRow && isLid) {
        try {
            console.log(`[INFO] Trying WAHA API to resolve LID ${normalizedPhone}...`);
            const wahaContact = await waha.getContactById(normalizedPhone + '@lid');
            console.log(`[INFO] WAHA getContactById result: ${JSON.stringify(wahaContact).slice(0, 500)}`);
            if (wahaContact) {
                // Try to extract a phone number from the WAHA contact response
                const wahaPhone = wahaContact.id?.replace('@c.us', '')
                    || wahaContact.phone
                    || wahaContact.number
                    || '';
                const wahaPhoneDigits = String(wahaPhone).replace(/\D/g, '');
                if (wahaPhoneDigits && !wahaPhoneDigits.includes(normalizedPhone)) {
                    // Found a real phone number — look up in contacts
                    contactRow = db.prepare(`
                        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
                    `).get(wahaPhoneDigits);
                    if (contactRow) {
                        // Save LID mapping for future lookups
                        db.prepare('UPDATE contacts SET lid = ? WHERE id = ?').run(normalizedPhone, contactRow.id);
                        console.log(`[INFO] Resolved LID ${normalizedPhone} → ${contactRow.name} (${contactRow.phone}) via WAHA API, saved mapping`);
                    }
                }
            }
        } catch (err) {
            console.error(`[WARN] WAHA LID resolution failed for ${normalizedPhone}:`, err.message);
        }
    }

    if (!contactRow) {
        // Don't auto-create contacts for LIDs — they're not real phone numbers
        if (isLid) {
            console.log(`[WARN] Unknown LID ${normalizedPhone} — could not resolve to any known contact`);
            return null;
        }
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

    // Parse vote — matches native WhatsApp poll options ("Ja ✅", "Nein ❌", "Vielleicht 🤷")
    const lower = text.toLowerCase().trim();
    const stripped = lower.replace(/[✅❌🤷\uFE0F\u200D]/g, '').trim();
    let response = null;

    if (stripped === 'ja') response = 'yes';
    else if (stripped === 'nein') response = 'no';
    else if (stripped === 'vielleicht') response = 'maybe';

    if (!response) return null;

    // Find the correct active poll — match by poll message ID first, fallback to earliest deadline
    let activePoll = null;
    if (pollMessageId) {
        activePoll = db.prepare(`
            SELECT p.id as poll_id, p.event_date, e.title as event_title
            FROM polls p JOIN events e ON p.event_id = e.id
            WHERE p.status = 'active' AND p.poll_message_id = ?
        `).get(pollMessageId);
    }
    if (!activePoll) {
        activePoll = db.prepare(`
            SELECT p.id as poll_id, p.event_date, e.title as event_title
            FROM polls p JOIN events e ON p.event_id = e.id
            WHERE p.status = 'active'
            ORDER BY p.deadline ASC LIMIT 1
        `).get();
    }

    if (!activePoll) {
        // Check if there's a recently closed poll — send "too late" notification
        if (contactRow) {
            const closedPoll = db.prepare(`
                SELECT p.event_date, e.title as event_title
                FROM polls p JOIN events e ON p.event_id = e.id
                WHERE p.status = 'closed' AND p.archived = 0
                ORDER BY p.deadline DESC LIMIT 1
            `).get();
            if (closedPoll && contactRow.phone) {
                const chatId = contactRow.phone.replace('+', '') + '@c.us';
                waha.sendTooLateNotification(chatId, closedPoll.event_title, closedPoll.event_date)
                    .catch(e => console.error('[ERROR] sendTooLateNotification:', e.message));
                console.log(`[VOTE] Too late vote from ${contactRow.name} for ${closedPoll.event_title} — notification sent`);
            }
        }
        return null;
    }

    // Ensure response row exists, then check previous vote
    db.prepare(`
        INSERT OR IGNORE INTO poll_responses (poll_id, contact_id) VALUES (?, ?)
    `).run(activePoll.poll_id, contactRow.id);

    const previousResponse = db.prepare(`
        SELECT response, reason FROM poll_responses WHERE poll_id = ? AND contact_id = ?
    `).get(activePoll.poll_id, contactRow.id);

    const isVoteChange = previousResponse && previousResponse.response && previousResponse.response !== response;

    // Keep old reason on vote change — only replaced if user sends a new comment within 5 min
    db.prepare(`
        UPDATE poll_responses SET response = ?, responded_at = datetime('now')
        WHERE poll_id = ? AND contact_id = ?
    `).run(response, activePoll.poll_id, contactRow.id);

    // Send follow-up for all vote types
    const chatId = contactRow.phone.replace('+', '') + '@c.us';
    if (isVoteChange) {
        waha.sendVoteChangeFollowUp(chatId, activePoll.event_title, activePoll.event_date, response, previousResponse.reason)
            .catch(e => console.error('[ERROR] sendVoteChangeFollowUp:', e.message));
    } else if (response === 'yes') {
        waha.sendYesFollowUp(chatId, activePoll.event_title, activePoll.event_date)
            .catch(e => console.error('[ERROR] sendYesFollowUp:', e.message));
    } else if (response === 'maybe') {
        waha.sendMaybeFollowUp(chatId, activePoll.event_title, activePoll.event_date)
            .catch(e => console.error('[ERROR] sendMaybeFollowUp:', e.message));
    } else if (response === 'no') {
        waha.sendNoFollowUp(chatId, activePoll.event_title, activePoll.event_date)
            .catch(e => console.error('[ERROR] sendNoFollowUp:', e.message));
    }

    scheduleDescriptionUpdate();
    return { contactName: contactRow.name, response, pollId: activePoll.poll_id };
}

// Save a reason text from a contact who previously voted 'maybe' or 'no'
function processReasonMessage(phone, text) {
    const normalizedPhone = phone.replace(/@c\.us|@lid|@s\.whatsapp\.net/g, '').replace(/^\+/, '').replace(/\D/g, '');
    const contact = db.prepare(`
        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
    `).get(normalizedPhone);
    if (!contact) return null;

    // Find most recent response within 5 minutes (allows overwriting existing reason on vote change)
    const pendingReason = db.prepare(`
        SELECT pr.id, p.id as poll_id, pr.response
        FROM poll_responses pr
        JOIN polls p ON pr.poll_id = p.id
        WHERE pr.contact_id = ? AND pr.response IN ('yes', 'maybe', 'no')
        AND p.archived = 0
        AND pr.responded_at >= datetime('now', '-5 minutes')
        ORDER BY p.id DESC LIMIT 1
    `).get(contact.id);

    if (!pendingReason) return null;

    db.prepare('UPDATE poll_responses SET reason = ? WHERE id = ?').run(text.trim(), pendingReason.id);
    console.log(`[INFO] Reason saved for ${contact.name} (${pendingReason.response}): "${text.trim()}" (poll ${pendingReason.poll_id})`);
    scheduleDescriptionUpdate();
    return { pollId: pendingReason.poll_id, contactName: contact.name };
}

async function sendDeadlineReminder(pollId, isSecond) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.description, e.event_time, e.end_time, e.meeting_time
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
            await waha.sendReminder(chatId, poll.title, poll.event_date, poll.event_time, poll.end_time, deadlineTime, poll.meeting_time, poll.description);
        } catch (err) {
            console.error(`Failed to send reminder to ${r.name}:`, err.message);
        }
    }

    if (isSecond) {
        db.prepare('UPDATE polls SET reminder_2_sent = 1 WHERE id = ?').run(pollId);
    } else {
        db.prepare('UPDATE polls SET reminder_sent = 1 WHERE id = ?').run(pollId);
    }
}

// Post results to group WITHOUT closing the poll or changing status
async function postGroupResults(pollId, cancelInfo) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.description, e.event_time, e.end_time, e.meeting_time, e.auto_cancel, e.min_participants
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

    const yes = responses.filter(r => r.response === 'yes').map(r => ({ name: r.name, reason: r.reason }));
    const no = responses.filter(r => r.response === 'no').map(r => ({ name: r.name, reason: r.reason }));
    const maybe = responses.filter(r => r.response === 'maybe').map(r => ({ name: r.name, reason: r.reason }));
    const pending = responses.filter(r => !r.response).map(r => ({ name: r.name }));

    const resultResponse = await waha.postResultsToGroup(GROUP_CHAT_ID, poll.title, poll.event_date, poll.event_time, poll.end_time, yes, no, maybe, pending, poll.meeting_time, cancelInfo, poll.description);

    // Save result message ID and pin it
    const resultMessageId = extractMessageId(resultResponse);

    // Send chart image to group
    try {
        const imageBuffer = generateResultChart(poll.title, poll.event_date, yes.length, no.length, maybe.length, pending.length);
        const fmtDate = (d) => { const [y,m,dd] = d.split('-'); return `${dd}.${m}.${y}`; };
        await waha.sendResultImage(GROUP_CHAT_ID, imageBuffer, `📊 Abstimmung: ${poll.title} – ${fmtDate(poll.event_date)}`);
    } catch (err) {
        console.error('[ERROR] sendResultImage:', err.message);
    }

    // Only mark as posted (don't change status — use closePoll() for that)
    db.prepare('UPDATE polls SET group_posted = 1, result_message_id = ? WHERE id = ?').run(resultMessageId, pollId);

    if (resultMessageId) {
        waha.pinMessage(GROUP_CHAT_ID, resultMessageId)
            .catch(e => console.error('[ERROR] pinMessage result:', e.message));
    }
    scheduleDescriptionUpdate();
}

// Reset an active poll: clear all responses, re-send to group as new WhatsApp poll
async function resendPoll(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.description, e.event_time, e.end_time, e.meeting_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) throw new Error(`Poll ${pollId} not found`);
    if (poll.status !== 'active') throw new Error('Nur aktive Umfragen können neu gesendet werden');
    if (!GROUP_CHAT_ID) throw new Error('GROUP_CHAT_ID not configured');

    // Unpin old poll message
    if (poll.poll_message_id) {
        waha.unpinMessage(GROUP_CHAT_ID, poll.poll_message_id)
            .catch(e => console.error('[ERROR] unpinMessage old poll:', e.message));
    }

    // Reset all responses
    db.prepare('UPDATE poll_responses SET response = NULL, reason = NULL, responded_at = NULL WHERE poll_id = ?').run(pollId);

    // Reset reminder flags so they fire again
    db.prepare('UPDATE polls SET reminder_sent = 0, reminder_2_sent = 0 WHERE id = ?').run(pollId);

    // Sync latest group members
    await syncGroupParticipants();

    // Add any new contacts
    const existingContactIds = db.prepare('SELECT contact_id FROM poll_responses WHERE poll_id = ?').all(pollId).map(r => r.contact_id);
    const allContacts = db.prepare('SELECT * FROM contacts').all();
    const insertResponse = db.prepare('INSERT OR IGNORE INTO poll_responses (poll_id, contact_id) VALUES (?, ?)');
    for (const c of allContacts) {
        if (!existingContactIds.includes(c.id)) {
            insertResponse.run(pollId, c.id);
        }
    }

    // Send new WhatsApp poll
    const pollResult = await waha.sendPollMessage(GROUP_CHAT_ID, poll.title, poll.event_date, poll.event_time, poll.end_time, poll.meeting_time, poll.description);
    const pollMessageId = extractMessageId(pollResult);

    db.prepare("UPDATE polls SET poll_message_id = ?, sent_at = datetime('now') WHERE id = ?").run(pollMessageId, pollId);

    if (pollMessageId) {
        waha.pinMessage(GROUP_CHAT_ID, pollMessageId)
            .catch(e => console.error('[ERROR] pinMessage resend:', e.message));
    }

    console.log(`[INFO] Poll ${pollId} resent (reset + new WhatsApp poll)`);
    scheduleDescriptionUpdate();
}

// Explicitly close a poll (deadline passed or manual action)
function closePoll(pollId) {
    const poll = db.prepare('SELECT poll_message_id FROM polls WHERE id = ?').get(pollId);
    db.prepare("UPDATE polls SET status = 'closed' WHERE id = ? AND status = 'active'").run(pollId);

    // Unpin the poll message
    if (poll?.poll_message_id) {
        const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';
        if (GROUP_CHAT_ID) {
            waha.unpinMessage(GROUP_CHAT_ID, poll.poll_message_id)
                .catch(e => console.error('[ERROR] unpinMessage poll:', e.message));
        }
    }
    scheduleDescriptionUpdate();
}

// Extend the deadline of an active or pending poll by N minutes
function extendDeadline(pollId, minutes) {
    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) throw new Error(`Poll ${pollId} not found`);
    if (poll.status === 'closed') throw new Error('Geschlossene Umfragen können nicht verlängert werden');

    const current = new Date(poll.deadline);
    const newDeadline = new Date(current.getTime() + minutes * 60 * 1000);
    db.prepare('UPDATE polls SET deadline = ?, reminder_sent = 0, reminder_2_sent = 0 WHERE id = ?')
        .run(newDeadline.toISOString(), pollId);
    scheduleDescriptionUpdate();
    return newDeadline.toISOString();
}

async function sendEventReminders(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.description, e.event_time, e.end_time, e.meeting_time, e.event_reminder_minutes
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) return;

    const yesResponses = db.prepare(`
        SELECT c.phone, c.name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ? AND pr.response = 'yes'
    `).all(pollId);

    const minutes = poll.event_reminder_minutes ?? 60;
    for (const r of yesResponses) {
        try {
            const chatId = r.phone.replace('+', '') + '@c.us';
            await waha.sendEventReminder(chatId, poll.title, poll.event_time, poll.end_time, poll.meeting_time, poll.description, minutes);
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
    resendPoll,
    extendDeadline,
    sendEventReminders,
};
