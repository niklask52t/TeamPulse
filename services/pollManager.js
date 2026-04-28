const db = require('../db/database');
const evolution = require('./evolution');
const { parseBerlinDateTime, TZ } = require('./timeUtils');
const { generateResultChart } = require('./chartGenerator');

const { scheduleDescriptionUpdate } = require('./groupDescription');
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';

// Extract message ID string from Evolution response (handles various response shapes)
// Always returns a string or null — never undefined or objects
function extractMessageId(result) {
    if (!result) return null;
    const raw = result.id || result.key?.id || result.key?._serialized || result._data?.id || null;
    if (raw == null) return null;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object') return String(raw._serialized || raw.id || JSON.stringify(raw));
    return String(raw);
}

function normalizeMessageId(id) {
    if (!id) return '';
    const text = typeof id === 'string' ? id : String(id._serialized || id.id || JSON.stringify(id));
    return text.trim();
}

function collectMessageIdCandidates(value, out = new Set()) {
    if (value == null) return out;
    if (Array.isArray(value)) {
        for (const item of value) collectMessageIdCandidates(item, out);
        return out;
    }
    if (typeof value === 'object') {
        collectMessageIdCandidates(value.id, out);
        collectMessageIdCandidates(value._serialized, out);
        collectMessageIdCandidates(value.key?.id, out);
        collectMessageIdCandidates(value.key?._serialized, out);
        collectMessageIdCandidates(value.messageId, out);
        collectMessageIdCandidates(value.pollMessageId, out);
        collectMessageIdCandidates(value.parentMessageId, out);
        return out;
    }

    const text = String(value).trim();
    if (!text) return out;
    out.add(text);

    const loose = text.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (loose) out.add(`loose:${loose}`);
    return out;
}

function messageIdsMatch(left, right) {
    const leftSet = collectMessageIdCandidates(left);
    const rightSet = collectMessageIdCandidates(right);
    for (const candidate of leftSet) {
        if (rightSet.has(candidate)) return true;
    }
    return false;
}

function calculatePollSchedule(event, eventDate, deadlineMinutes, sendMinutesBefore) {
    const eventDateTime = parseBerlinDateTime(eventDate, event.event_time);
    if (isNaN(eventDateTime.getTime())) {
        throw new Error(`Invalid event date/time for event ${event.id}: ${eventDate} ${event.event_time}`);
    }

    let deadline;
    if (event.poll_deadline_at) {
        const [dlDate, dlTime] = event.poll_deadline_at.split('T');
        deadline = parseBerlinDateTime(dlDate, dlTime || '00:00');
    } else {
        deadline = new Date(eventDateTime.getTime() - (deadlineMinutes || event.poll_deadline_minutes || 60) * 60 * 1000);
    }

    let sendAfter;
    if (event.poll_send_at) {
        const [sendDate, sendTime] = event.poll_send_at.split('T');
        sendAfter = parseBerlinDateTime(sendDate, sendTime || '00:00');
    } else {
        sendAfter = new Date(eventDateTime.getTime() - (sendMinutesBefore || event.poll_send_minutes_before || 1440) * 60 * 1000);
    }

    if (isNaN(deadline.getTime()) || isNaN(sendAfter.getTime())) {
        throw new Error(`Invalid poll schedule for event ${event.id}`);
    }

    return { sendAfter, deadline };
}

// In-memory lock to prevent duplicate sends from overlapping scheduler ticks
const sendingPolls = new Set();

// Sync group participants from Evolution into the local contacts table
async function syncGroupParticipants() {
    if (!GROUP_CHAT_ID) {
        console.warn('[WARN] GROUP_CHAT_ID not set, skipping participant sync');
        return;
    }
    try {
        const [participants, allContacts] = await Promise.all([
            evolution.getGroupParticipants(GROUP_CHAT_ID),
            evolution.getAllContacts(),
        ]);

        // Build phone → name map and phone → lid map from Evolution contacts
        const nameMap = {};
        const lidMap = {}; // phone digits → lid digits
        for (const c of allContacts) {
            if (!c.id) continue;
            const phone = c.id.replace('@c.us', '').replace('@s.whatsapp.net', '');
            nameMap[phone] = c.name || c.pushname || c.shortName || '';
            // Evolution may provide lid in various fields
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
            const phoneDigits = rawId.replace('@c.us', '').replace('@s.whatsapp.net', '').replace(/\D/g, '');
            if (!phoneDigits) continue;
            const phone = '+' + phoneDigits;
            const name = nameMap[phoneDigits] || nameMap[rawId.replace('@c.us', '').replace('@s.whatsapp.net', '')] || phone;
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

    const { sendAfter, deadline } = calculatePollSchedule(event, eventDate, deadlineMinutes, sendMinutesBefore);

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

    sendingPolls.add(pollId);
    try {
        // Sync latest group members before sending
        await syncGroupParticipants();

        // Add any new contacts (synced after poll creation) as pending responses
        const existingContactIds = new Set(db.prepare(`
            SELECT contact_id FROM poll_responses WHERE poll_id = ?
        `).all(pollId).map(r => r.contact_id));

        const allContacts = db.prepare('SELECT * FROM contacts').all();
        const insertResponse = db.prepare(`
            INSERT OR IGNORE INTO poll_responses (poll_id, contact_id) VALUES (?, ?)
        `);
        for (const c of allContacts) {
            if (!existingContactIds.has(c.id)) {
                insertResponse.run(pollId, c.id);
            }
        }

        const pollResult = await evolution.sendPollMessage(GROUP_CHAT_ID, poll.title, poll.event_date, poll.event_time, poll.end_time, poll.meeting_time, poll.description);

        // Save message ID and pin the poll
        console.log(`[DEBUG] sendPoll response: ${JSON.stringify(pollResult).slice(0, 500)}`);
        const pollMessageId = extractMessageId(pollResult);
        db.prepare('UPDATE poll_responses SET message_sent = 1 WHERE poll_id = ?').run(pollId);
        db.prepare("UPDATE polls SET status = 'active', sent_at = datetime('now'), poll_message_id = ? WHERE id = ?").run(pollMessageId, pollId);

        if (pollMessageId) {
            evolution.pinMessage(GROUP_CHAT_ID, pollMessageId)
                .catch(e => console.error('[ERROR] pinMessage poll:', e.message));
        }
        console.log(`[INFO] Poll ${pollId} sent to group ${GROUP_CHAT_ID}`);
        scheduleDescriptionUpdate();
    } finally {
        sendingPolls.delete(pollId);
    }
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

    // If still not found and it's a LID, try resolving via Evolution API
    if (!contactRow && isLid) {
        try {
            console.log(`[INFO] Trying Evolution API to resolve LID ${normalizedPhone}...`);
            const providerContact = await evolution.getContactById(normalizedPhone + '@lid');
            console.log(`[INFO] Evolution getContactById result: ${JSON.stringify(providerContact).slice(0, 500)}`);
            if (providerContact) {
                const providerPhone = providerContact.id?.replace('@c.us', '').replace('@s.whatsapp.net', '')
                    || providerContact.phone
                    || providerContact.number
                    || '';
                const providerPhoneDigits = String(providerPhone).replace(/\D/g, '');
                if (providerPhoneDigits && !providerPhoneDigits.includes(normalizedPhone)) {
                    contactRow = db.prepare(`
                        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
                    `).get(providerPhoneDigits);
                    if (contactRow) {
                        db.prepare('UPDATE contacts SET lid = ? WHERE id = ?').run(normalizedPhone, contactRow.id);
                        console.log(`[INFO] Resolved LID ${normalizedPhone} -> ${contactRow.name} (${contactRow.phone}) via Evolution API, saved mapping`);
                    }
                }
            }
        } catch (err) {
            console.error(`[WARN] Evolution LID resolution failed for ${normalizedPhone}:`, err.message);
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
        const incomingId = Array.isArray(pollMessageId) ? pollMessageId.find(Boolean) : pollMessageId;
        const normalizedPollMessageId = normalizeMessageId(incomingId);
        const activePolls = db.prepare(`
            SELECT p.id as poll_id, p.event_date, p.poll_message_id, p.sent_at, e.title as event_title
            FROM polls p JOIN events e ON p.event_id = e.id
            WHERE p.status = 'active'
            ORDER BY datetime(COALESCE(p.sent_at, '1970-01-01T00:00:00Z')) DESC, p.id DESC
        `).all();

        activePoll = activePolls.find(p => p.poll_message_id && messageIdsMatch(p.poll_message_id, pollMessageId)) || null;

        if (!activePoll && normalizedPollMessageId) {
            console.warn(`[WARN] No active poll matched incoming pollMessageId=${normalizedPollMessageId}. Active polls: ${activePolls.map(p => `${p.poll_id}:${p.poll_message_id || 'none'}`).join(', ')}`);
        }
    }
    if (!activePoll) {
        const activePolls = db.prepare(`
            SELECT p.id as poll_id, p.event_date, p.poll_message_id, p.sent_at, e.title as event_title
            FROM polls p JOIN events e ON p.event_id = e.id
            WHERE p.status = 'active'
            ORDER BY datetime(COALESCE(p.sent_at, '1970-01-01T00:00:00Z')) DESC, p.id DESC
        `).all();

        if (activePolls.length === 1) {
            activePoll = activePolls[0];
            console.warn(`[WARN] Vote matched via single-active-poll fallback. phone=${phone} pollId=${activePoll.poll_id} option=${text}`);
        } else if (activePolls.length > 1) {
            const incomingId = Array.isArray(pollMessageId) ? pollMessageId.join(' | ') : (pollMessageId || 'none');
            console.warn(`[WARN] Vote ignored because poll message ID was missing or unknown and ${activePolls.length} active polls exist. phone=${phone} pollMessageId=${incomingId} option=${text}`);
            return null;
        }
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
                evolution.sendTooLateNotification(chatId, closedPoll.event_title, closedPoll.event_date)
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
        evolution.sendVoteChangeFollowUp(chatId, activePoll.event_title, activePoll.event_date, response, previousResponse.reason)
            .catch(e => console.error('[ERROR] sendVoteChangeFollowUp:', e.message));
    } else if (response === 'yes') {
        evolution.sendYesFollowUp(chatId, activePoll.event_title, activePoll.event_date)
            .catch(e => console.error('[ERROR] sendYesFollowUp:', e.message));
    } else if (response === 'maybe') {
        evolution.sendMaybeFollowUp(chatId, activePoll.event_title, activePoll.event_date)
            .catch(e => console.error('[ERROR] sendMaybeFollowUp:', e.message));
    } else if (response === 'no') {
        evolution.sendNoFollowUp(chatId, activePoll.event_title, activePoll.event_date)
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
            await evolution.sendReminder(chatId, poll.title, poll.event_date, poll.event_time, poll.end_time, deadlineTime, poll.meeting_time, poll.description);
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
async function postGroupResults(pollId, cancelInfo, options = {}) {
    const markPosted = options.markPosted !== false;
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

    const resultResponse = await evolution.postResultsToGroup(GROUP_CHAT_ID, poll.title, poll.event_date, poll.event_time, poll.end_time, yes, no, maybe, pending, poll.meeting_time, cancelInfo, poll.description);

    // Save result message ID and pin it
    const resultMessageId = extractMessageId(resultResponse);

    // Send chart image to group
    try {
        const imageBuffer = generateResultChart(poll.title, poll.event_date, yes.length, no.length, maybe.length, pending.length);
        const fmtDate = (d) => { const [y,m,dd] = d.split('-'); return `${dd}.${m}.${y}`; };
        await evolution.sendResultImage(GROUP_CHAT_ID, imageBuffer, `📊 Abstimmung: ${poll.title} – ${fmtDate(poll.event_date)}`);
    } catch (err) {
        console.error('[ERROR] sendResultImage:', err.message);
    }

    // Only mark as posted (don't change status — use closePoll() for that)
    if (markPosted) {
        db.prepare('UPDATE polls SET group_posted = 1, result_message_id = ? WHERE id = ?').run(resultMessageId, pollId);
    } else if (resultMessageId) {
        db.prepare('UPDATE polls SET result_message_id = ? WHERE id = ?').run(resultMessageId, pollId);
    }

    if (resultMessageId) {
        evolution.pinMessage(GROUP_CHAT_ID, resultMessageId)
            .catch(e => console.error('[ERROR] pinMessage result:', e.message));
    }
    scheduleDescriptionUpdate();
}

function refreshOpenPollScheduleForEvent(eventId) {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) throw new Error(`Event ${eventId} not found`);

    const polls = db.prepare(`
        SELECT * FROM polls
        WHERE event_id = ? AND archived = 0 AND status IN ('pending', 'active')
    `).all(eventId);

    const update = db.prepare(`
        UPDATE polls
        SET event_date = ?, send_after = ?, deadline = ?, reminder_sent = 0, reminder_2_sent = 0, event_reminder_sent = 0
        WHERE id = ?
    `);

    let updated = 0;
    for (const poll of polls) {
        const eventDate = event.recurring ? poll.event_date : event.event_date;
        if (!eventDate) continue;
        const { sendAfter, deadline } = calculatePollSchedule(event, eventDate, event.poll_deadline_minutes, event.poll_send_minutes_before);
        update.run(eventDate, sendAfter.toISOString(), deadline.toISOString(), poll.id);
        updated++;
    }

    if (updated > 0) scheduleDescriptionUpdate();
    return updated;
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
        evolution.unpinMessage(GROUP_CHAT_ID, poll.poll_message_id)
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
    const pollResult = await evolution.sendPollMessage(GROUP_CHAT_ID, poll.title, poll.event_date, poll.event_time, poll.end_time, poll.meeting_time, poll.description);
    const pollMessageId = extractMessageId(pollResult);

    db.prepare("UPDATE polls SET poll_message_id = ?, sent_at = datetime('now') WHERE id = ?").run(pollMessageId, pollId);

    if (pollMessageId) {
        evolution.pinMessage(GROUP_CHAT_ID, pollMessageId)
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
            evolution.unpinMessage(GROUP_CHAT_ID, poll.poll_message_id)
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
            await evolution.sendEventReminder(chatId, poll.title, poll.event_time, poll.end_time, poll.meeting_time, poll.description, minutes);
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
    refreshOpenPollScheduleForEvent,
    processResponse,
    processReasonMessage,
    sendDeadlineReminder,
    postGroupResults,
    closePoll,
    resendPoll,
    extendDeadline,
    sendEventReminders,
};
