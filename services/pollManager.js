const db = require('../db/database');
const evolution = require('./evolution');
const { parseBerlinDateTime, TZ } = require('./timeUtils');
const { generateResultChart } = require('./chartGenerator');
const { scheduleDescriptionUpdate, scheduleImportantDescriptionUpdate } = require('./groupDescription');

const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';
const PINNED_POLL_ID_KEY = 'pinned_active_poll_id';
const PINNED_POLL_MESSAGE_ID_KEY = 'pinned_active_poll_message_id';

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

function normalizeDigits(value) {
    return String(value || '').replace(/@c\.us|@s\.whatsapp\.net|@lid|@g\.us/g, '').replace(/\D/g, '');
}

function extractParticipantId(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    return entry.id?._serialized
        || (entry.id?.user && entry.id?.server ? `${entry.id.user}@${entry.id.server}` : '')
        || entry.id
        || entry.jid?._serialized
        || entry.jid
        || entry.phoneNumber
        || entry.phone
        || entry.number
        || entry.mobile
        || entry.user
        || entry.wuid
        || entry.remoteJid
        || entry.userJid
        || entry.memberId
        || entry.participant
        || entry.key?.participant
        || entry.key?.remoteJid
        || entry.contactId
        || '';
}

function extractContactName(entry, fallbackPhone) {
    const name = entry?.name
        || entry?.pushname
        || entry?.pushName
        || entry?.fullName
        || entry?.notify
        || entry?.profileName
        || entry?.shortName
        || entry?.verifiedName
        || entry?.subject
        || '';
    return String(name || fallbackPhone || '').trim();
}

function countNameTokens(value) {
    return String(value || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .length;
}

function isPhoneLikeName(name, fallbackPhone = '') {
    const digits = normalizeDigits(name);
    const fallbackDigits = normalizeDigits(fallbackPhone);
    if (!digits) return false;
    if (fallbackDigits && digits === fallbackDigits) return true;
    return /^[+\d\s().-]+$/.test(String(name || '').trim());
}

function choosePreferredContactName(existingName, candidateName, fallbackPhone = '') {
    const existing = String(existingName || '').trim();
    const candidate = String(candidateName || '').trim();

    if (!existing) return candidate;
    if (!candidate) return existing;
    if (existing === candidate) return existing;

    const existingIsPhone = isPhoneLikeName(existing, fallbackPhone);
    const candidateIsPhone = isPhoneLikeName(candidate, fallbackPhone);

    if (existingIsPhone && !candidateIsPhone) return candidate;
    if (!existingIsPhone && candidateIsPhone) return existing;
    return candidate;
}

function extractParticipantLid(entry, fallbackId = '') {
    const direct = entry?.lid || entry?.lidJid || entry?.linkedDeviceId || entry?.key?.participantAlt || '';
    const directDigits = normalizeDigits(direct);
    if (directDigits) return directDigits;

    const raw = String(fallbackId || extractParticipantId(entry) || '');
    if (raw.endsWith('@lid')) return normalizeDigits(raw);
    return '';
}

function toPrivateChatId(phone) {
    return normalizeDigits(phone);
}

function getAppSetting(key) {
    return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value || null;
}

function isTruthySetting(value, fallback = false) {
    if (value == null) return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function shouldSendReasonRequestDm(contact) {
    if (!contact?.phone) return false;
    const globalEnabled = isTruthySetting(getAppSetting('reason_request_dm_enabled') || '1', true);
    if (!globalEnabled) return false;
    return contact.reason_dm_enabled !== 0 && String(contact.reason_dm_enabled) !== '0';
}

function setAppSetting(key, value) {
    db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, String(value));
}

function deleteAppSetting(key) {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

async function reconcilePinnedActivePoll() {
    if (!GROUP_CHAT_ID) return null;

    const targetPoll = db.prepare(`
        SELECT p.id, p.poll_message_id, p.sent_at, p.event_date, e.event_time, e.title
        FROM polls p
        JOIN events e ON p.event_id = e.id
        WHERE p.status = 'active' AND p.archived = 0 AND p.poll_message_id IS NOT NULL
        ORDER BY datetime(COALESCE(p.sent_at, '1970-01-01T00:00:00Z')) DESC, p.id DESC
        LIMIT 1
    `).get();

    const currentPinnedPollId = Number(getAppSetting(PINNED_POLL_ID_KEY) || 0) || null;
    const currentPinnedMessageId = normalizeMessageId(getAppSetting(PINNED_POLL_MESSAGE_ID_KEY));
    const targetMessageId = normalizeMessageId(targetPoll?.poll_message_id);

    if (currentPinnedMessageId && (!targetPoll || currentPinnedPollId !== targetPoll.id || currentPinnedMessageId !== targetMessageId)) {
        try {
            await evolution.unpinMessage(GROUP_CHAT_ID, currentPinnedMessageId);
            console.log(`[INFO] Unpin attempted for previous active poll message ${currentPinnedMessageId}`);
        } catch (err) {
            console.error('[ERROR] unpinMessage active poll:', err.message);
        }
    }

    if (!targetPoll) {
        deleteAppSetting(PINNED_POLL_ID_KEY);
        deleteAppSetting(PINNED_POLL_MESSAGE_ID_KEY);
        return null;
    }

    if (currentPinnedPollId !== targetPoll.id || currentPinnedMessageId !== targetMessageId) {
        try {
            await evolution.pinMessage(GROUP_CHAT_ID, targetMessageId);
            console.log(`[INFO] Pin attempted for active poll ${targetPoll.id} (${targetPoll.title})`);
        } catch (err) {
            console.error('[ERROR] pinMessage active poll:', err.message);
        }
    }

    setAppSetting(PINNED_POLL_ID_KEY, targetPoll.id);
    setAppSetting(PINNED_POLL_MESSAGE_ID_KEY, targetMessageId);
    return targetPoll.id;
}

function getResultPostMode() {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'result_post_mode'").get();
    return row?.value || 'both';
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

function addDays(dateStr, days) {
    const date = new Date(dateStr + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().split('T')[0];
}

const sendingPolls = new Set();

async function syncGroupParticipants() {
    if (!GROUP_CHAT_ID) {
        console.warn('[WARN] GROUP_CHAT_ID not set, skipping participant sync');
        return 0;
    }

    try {
        const [participants, allContacts] = await Promise.all([
            evolution.getGroupParticipants(GROUP_CHAT_ID),
            evolution.getAllContacts(),
        ]);

        console.log(`[SYNC] Group participant fetch returned ${participants.length} entries; contact fetch returned ${allContacts.length} entries`);

        const nameMap = {};
        const lidMap = {};
        for (const entry of allContacts) {
            const rawId = extractParticipantId(entry);
            const phoneDigits = normalizeDigits(rawId || entry.phone || entry.number || entry.mobile);
            if (!phoneDigits) continue;
            nameMap[phoneDigits] = extractContactName(entry, '+' + phoneDigits);

            const lidDigits = extractParticipantLid(entry, rawId);
            if (lidDigits) lidMap[phoneDigits] = lidDigits;
        }

        const insertContact = db.prepare('INSERT OR IGNORE INTO contacts (name, phone) VALUES (?, ?)');
        const selectContactByPhone = db.prepare('SELECT id, name, name_override FROM contacts WHERE phone = ?');
        const updateName = db.prepare('UPDATE contacts SET name = ? WHERE id = ?');
        const updateLid = db.prepare('UPDATE contacts SET lid = ? WHERE phone = ?');

        if (participants.length > 0) {
            console.log(`[SYNC] Participant[0] full keys: ${Object.keys(participants[0]).join(', ')}`);
            console.log(`[SYNC] Participant[0] full data: ${JSON.stringify(participants[0]).slice(0, 500)}`);
        }
        if (allContacts.length > 0) {
            console.log(`[SYNC] Contact[0] full keys: ${Object.keys(allContacts[0]).join(', ')}`);
            console.log(`[SYNC] Contact[0] full data: ${JSON.stringify(allContacts[0]).slice(0, 500)}`);
        }

        const desiredPhones = new Set();
        let synced = 0;
        let changed = 0;
        for (const participant of participants) {
            const rawId = extractParticipantId(participant);
            const resolvedId = rawId && !rawId.endsWith('@lid')
                ? rawId
                : (participant.phoneNumber || participant.phone || participant.number || participant.mobile || '');
            if (!resolvedId || resolvedId.endsWith('@g.us')) continue;

            const phoneDigits = normalizeDigits(resolvedId);
            if (!phoneDigits) continue;

            const phone = '+' + phoneDigits;
            desiredPhones.add(phone);
            const name = nameMap[phoneDigits] || extractContactName(participant, phone);
            const lidDigits = extractParticipantLid(participant, rawId) || lidMap[phoneDigits] || '';

            try {
                insertContact.run(name, phone);
                const existing = selectContactByPhone.get(phone);
                if (existing) {
                    const preferredName = choosePreferredContactName(existing.name, name, phone);
                    if (preferredName && preferredName !== existing.name) {
                        updateName.run(preferredName, existing.id);
                        changed++;
                    }
                }
                if (lidDigits) {
                    updateLid.run(lidDigits, phone);
                }
                synced++;
            } catch (err) {
                console.error(`[WARN] syncGroupParticipants upsert failed for ${phone}:`, err.message);
            }
        }

        let removed = 0;
        if (participants.length > 0) {
            const existingContacts = db.prepare('SELECT id, phone FROM contacts').all();
            const deleteContact = db.prepare('DELETE FROM contacts WHERE id = ?');
            for (const contact of existingContacts) {
                if (!desiredPhones.has(contact.phone)) {
                    deleteContact.run(contact.id);
                    removed++;
                }
            }
        }

        if (changed > 0 || removed > 0) {
            scheduleDescriptionUpdate();
        }

        console.log(`[INFO] Synced ${synced} group participants to contacts (${changed} name updates, ${removed} removed)`);
        return synced;
    } catch (err) {
        console.error('[ERROR] syncGroupParticipants:', err.message);
        return 0;
    }
}

async function syncPollRecipientsToCurrentGroup(pollId) {
    if (!GROUP_CHAT_ID) {
        console.warn('[WARN] GROUP_CHAT_ID not set, skipping poll recipient sync');
        return 0;
    }

    const participants = await evolution.getGroupParticipants(GROUP_CHAT_ID);
    const desiredContactIds = new Set();

    for (const participant of participants) {
        const rawId = extractParticipantId(participant);
        const resolvedId = rawId && !rawId.endsWith('@lid')
            ? rawId
            : (participant.phoneNumber || participant.phone || participant.number || participant.mobile || '');
        if (!resolvedId || resolvedId.endsWith('@g.us')) continue;

        const phoneDigits = normalizeDigits(resolvedId);
        if (!phoneDigits) continue;

        const phone = '+' + phoneDigits;
        const candidateName = extractContactName(participant, phone);
        let contact = db.prepare('SELECT id, name, name_override FROM contacts WHERE phone = ?').get(phone);
        if (!contact) {
            db.prepare('INSERT OR IGNORE INTO contacts (name, phone) VALUES (?, ?)').run(candidateName, phone);
            contact = db.prepare('SELECT id, name, name_override FROM contacts WHERE phone = ?').get(phone);
        } else {
            const preferredName = choosePreferredContactName(contact.name, candidateName, phone);
            if (preferredName && preferredName !== contact.name) {
                db.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(preferredName, contact.id);
                contact.name = preferredName;
            }
        }
        if (contact?.id) {
            const lidDigits = extractParticipantLid(participant, rawId);
            if (lidDigits) db.prepare('UPDATE contacts SET lid = ? WHERE id = ?').run(lidDigits, contact.id);
            desiredContactIds.add(contact.id);
        }
    }

    const existingResponses = db.prepare('SELECT id, contact_id FROM poll_responses WHERE poll_id = ?').all(pollId);
    const insertResponse = db.prepare('INSERT OR IGNORE INTO poll_responses (poll_id, contact_id) VALUES (?, ?)');
    const deleteResponse = db.prepare('DELETE FROM poll_responses WHERE id = ?');

    for (const contactId of desiredContactIds) {
        insertResponse.run(pollId, contactId);
    }

    let removed = 0;
    for (const row of existingResponses) {
        if (!desiredContactIds.has(row.contact_id)) {
            deleteResponse.run(row.id);
            removed++;
        }
    }

    console.log(`[INFO] Poll ${pollId} recipients synced to current group members (${desiredContactIds.size} active, ${removed} removed)`);
    return desiredContactIds.size;
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

    scheduleDescriptionUpdate();
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
        await syncGroupParticipants();
        await syncPollRecipientsToCurrentGroup(pollId);

        const pollResult = await evolution.sendPollMessage(
            GROUP_CHAT_ID,
            poll.title,
            poll.event_date,
            poll.event_time,
            poll.end_time,
            poll.meeting_time,
            poll.description
        );

        console.log(`[DEBUG] sendPoll response: ${JSON.stringify(pollResult).slice(0, 500)}`);
        const pollMessageId = extractMessageId(pollResult);

        db.prepare('UPDATE poll_responses SET message_sent = 1 WHERE poll_id = ?').run(pollId);
        db.prepare("UPDATE polls SET status = 'active', sent_at = datetime('now'), poll_message_id = ? WHERE id = ?").run(pollMessageId, pollId);

        await reconcilePinnedActivePoll();
        console.log(`[INFO] Poll ${pollId} sent to group ${GROUP_CHAT_ID}`);
        scheduleImportantDescriptionUpdate();
    } finally {
        sendingPolls.delete(pollId);
    }
}

async function processResponse(phone, text, pollMessageId) {
    const isLid = String(phone || '').includes('@lid');
    const normalizedPhone = normalizeDigits(phone);

    let contactRow = db.prepare(`
        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
    `).get(normalizedPhone);

    if (!contactRow && isLid) {
        contactRow = db.prepare('SELECT * FROM contacts WHERE lid = ?').get(normalizedPhone);
        if (contactRow) {
            console.log(`[INFO] Matched LID ${normalizedPhone} to contact ${contactRow.name} (${contactRow.phone}) via DB`);
        }
    }

    if (!contactRow && isLid) {
        try {
            console.log(`[INFO] Trying Evolution API to resolve LID ${normalizedPhone}...`);
            const providerContact = await evolution.getContactById(normalizedPhone + '@lid');
            console.log(`[INFO] Evolution getContactById result: ${JSON.stringify(providerContact).slice(0, 500)}`);
            if (providerContact) {
                const providerPhoneDigits = normalizeDigits(
                    extractParticipantId(providerContact) || providerContact.phone || providerContact.number || ''
                );
                if (providerPhoneDigits && providerPhoneDigits !== normalizedPhone) {
                    contactRow = db.prepare(`
                        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
                    `).get(providerPhoneDigits);
                    if (contactRow) {
                        db.prepare('UPDATE contacts SET lid = ? WHERE id = ?').run(normalizedPhone, contactRow.id);
                        console.log('[INFO] Resolved LID %s -> %s (%s) via Evolution API, saved mapping', normalizedPhone, contactRow.name, contactRow.phone);
                    }
                }
            }
        } catch (err) {
            console.error('[WARN] Evolution LID resolution failed for %s:', normalizedPhone, err.message);
        }
    }

    if (!contactRow && isLid && GROUP_CHAT_ID) {
        try {
            console.log(`[INFO] Trying group participant lookup for LID ${normalizedPhone}...`);
            const participants = await evolution.getGroupParticipants(GROUP_CHAT_ID);
            const match = participants.find((participant) => extractParticipantLid(participant) === normalizedPhone);
            if (match) {
                const rawId = extractParticipantId(match);
                const resolvedId = rawId && !rawId.endsWith('@lid')
                    ? rawId
                    : (match.phoneNumber || match.phone || match.number || match.mobile || '');
                const phoneDigits = normalizeDigits(resolvedId);
                if (phoneDigits) {
                    const phone = '+' + phoneDigits;
                    const name = extractContactName(match, phone);
                    db.prepare('INSERT OR IGNORE INTO contacts (name, phone) VALUES (?, ?)').run(name, phone);
                    const existing = db.prepare('SELECT id, name, name_override FROM contacts WHERE phone = ?').get(phone);
                    if (existing) {
                        const preferredName = choosePreferredContactName(existing.name, name, phone);
                        db.prepare('UPDATE contacts SET name = ?, lid = ? WHERE id = ?').run(preferredName, normalizedPhone, existing.id);
                    } else {
                        db.prepare('UPDATE contacts SET lid = ? WHERE phone = ?').run(normalizedPhone, phone);
                    }
                    contactRow = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
                    if (contactRow) {
                        console.log(`[INFO] Resolved LID ${normalizedPhone} -> ${contactRow.name} (${contactRow.phone}) via group participant lookup`);
                    }
                }
            }
        } catch (err) {
            console.error('[WARN] Group participant LID lookup failed for %s:', normalizedPhone, err.message);
        }
    }

    if (!contactRow) {
        if (isLid) {
            console.log(`[WARN] Unknown LID ${normalizedPhone} - could not resolve to any known contact`);
            return null;
        }
        try {
            db.prepare('INSERT OR IGNORE INTO contacts (name, phone) VALUES (?, ?)').run('+' + normalizedPhone, '+' + normalizedPhone);
            console.log(`[INFO] Auto-created contact for ${normalizedPhone}`);
        } catch {
            // ignore
        }
        contactRow = db.prepare(`
            SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
        `).get(normalizedPhone);
    }

    if (!contactRow) return null;

    const displayName = contactRow.name_override || contactRow.name;

    const stripped = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    let response = null;
    if (stripped === 'ja') response = 'yes';
    else if (stripped === 'nein') response = 'no';
    else if (stripped === 'vielleicht') response = 'maybe';
    if (!response) return null;

    const activePolls = db.prepare(`
        SELECT p.id as poll_id, p.event_date, p.poll_message_id, p.sent_at, e.title as event_title
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.status = 'active'
        ORDER BY datetime(COALESCE(p.sent_at, '1970-01-01T00:00:00Z')) DESC, p.id DESC
    `).all();

    let activePoll = null;
    if (pollMessageId) {
        const incomingId = Array.isArray(pollMessageId) ? pollMessageId.find(Boolean) : pollMessageId;
        const normalizedPollMessageId = normalizeMessageId(incomingId);
        activePoll = activePolls.find((poll) => poll.poll_message_id && messageIdsMatch(poll.poll_message_id, pollMessageId)) || null;

        if (!activePoll && normalizedPollMessageId) {
            console.warn(`[WARN] No active poll matched incoming pollMessageId=${normalizedPollMessageId}. Active polls: ${activePolls.map((poll) => `${poll.poll_id}:${poll.poll_message_id || 'none'}`).join(', ')}`);
        }
    }

    if (!activePoll && pollMessageId) {
        const incomingId = Array.isArray(pollMessageId) ? pollMessageId.join(' | ') : pollMessageId;
        console.warn(`[WARN] Vote ignored because pollMessageId did not match an active poll. phone=${phone} pollMessageId=${incomingId || 'none'} option=${text}`);
        return null;
    }

    if (!activePoll) {
        const pollsWithoutMessageId = activePolls.filter((poll) => !poll.poll_message_id);
        if (activePolls.length === 1 && pollsWithoutMessageId.length === 1) {
            activePoll = activePolls[0];
            console.warn(`[WARN] Vote matched via no-message-id fallback. phone=${phone} pollId=${activePoll.poll_id} option=${text}`);
        } else if (activePolls.length > 0) {
            const incomingId = Array.isArray(pollMessageId) ? pollMessageId.join(' | ') : (pollMessageId || 'none');
            console.warn(`[WARN] Vote ignored because no safe poll match was possible. activePolls=${activePolls.length} pollsWithoutMessageId=${pollsWithoutMessageId.length} phone=${phone} pollMessageId=${incomingId} option=${text}`);
            return null;
        }
    }

    if (!activePoll) {
        const closedPoll = db.prepare(`
            SELECT p.event_date, e.title as event_title
            FROM polls p JOIN events e ON p.event_id = e.id
            WHERE p.status = 'closed' AND p.archived = 0
            ORDER BY p.deadline DESC LIMIT 1
        `).get();
        if (closedPoll && contactRow.phone) {
            evolution.sendTooLateNotification(toPrivateChatId(contactRow.phone), closedPoll.event_title, closedPoll.event_date)
                .catch((err) => console.error('[ERROR] sendTooLateNotification:', err.message));
            console.log(`[VOTE] Too late vote from ${displayName} for ${closedPoll.event_title} - notification sent`);
        }
        return null;
    }

    db.prepare(`
        INSERT OR IGNORE INTO poll_responses (poll_id, contact_id) VALUES (?, ?)
    `).run(activePoll.poll_id, contactRow.id);

    const previousResponse = db.prepare(`
        SELECT response, reason FROM poll_responses WHERE poll_id = ? AND contact_id = ?
    `).get(activePoll.poll_id, contactRow.id);
    const isVoteChange = previousResponse && previousResponse.response && previousResponse.response !== response;

    db.prepare(`
        UPDATE poll_responses SET response = ?, responded_at = datetime('now')
        WHERE poll_id = ? AND contact_id = ?
    `).run(response, activePoll.poll_id, contactRow.id);

    const chatId = toPrivateChatId(contactRow.phone);
    if (shouldSendReasonRequestDm(contactRow)) {
        if (isVoteChange) {
            evolution.sendVoteChangeFollowUp(chatId, activePoll.event_title, activePoll.event_date, response, previousResponse.reason)
                .catch((err) => console.error('[ERROR] sendVoteChangeFollowUp:', err.message));
        } else if (response === 'yes') {
            evolution.sendYesFollowUp(chatId, activePoll.event_title, activePoll.event_date)
                .catch((err) => console.error('[ERROR] sendYesFollowUp:', err.message));
        } else if (response === 'maybe') {
            evolution.sendMaybeFollowUp(chatId, activePoll.event_title, activePoll.event_date)
                .catch((err) => console.error('[ERROR] sendMaybeFollowUp:', err.message));
        } else if (response === 'no') {
            evolution.sendNoFollowUp(chatId, activePoll.event_title, activePoll.event_date)
                .catch((err) => console.error('[ERROR] sendNoFollowUp:', err.message));
        }
    }

    scheduleDescriptionUpdate();
    return { contactName: displayName, response, pollId: activePoll.poll_id };
}

function processReasonMessage(phone, text) {
    const normalizedPhone = normalizeDigits(phone);
    const contact = db.prepare(`
        SELECT * FROM contacts WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') = ?
    `).get(normalizedPhone);
    if (!contact) return null;

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

    db.prepare('UPDATE poll_responses SET reason = ? WHERE id = ?').run(String(text || '').trim(), pendingReason.id);
    const contactName = contact.name_override || contact.name;
    console.log(`[INFO] Reason saved for ${contactName} (${pendingReason.response}): "${String(text || '').trim()}" (poll ${pendingReason.poll_id})`);
    scheduleImportantDescriptionUpdate();
    return { pollId: pendingReason.poll_id, contactName };
}

async function sendDeadlineReminder(pollId, isSecond) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.description, e.event_time, e.end_time, e.meeting_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) return;

    const deadlineTime = new Date(poll.deadline).toLocaleString('de-DE', {
        timeZone: TZ,
        hour: '2-digit',
        minute: '2-digit',
    });

    const pending = db.prepare(`
        SELECT pr.*, c.phone, COALESCE(NULLIF(c.name_override, ''), c.name) AS name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ? AND pr.response IS NULL
    `).all(pollId);

    for (const row of pending) {
        try {
            await evolution.sendReminder(
                toPrivateChatId(row.phone),
                poll.title,
                poll.event_date,
                poll.event_time,
                poll.end_time,
                deadlineTime,
                poll.meeting_time,
                poll.description
            );
        } catch (err) {
            console.error(`Failed to send reminder to ${row.name}:`, err.message);
        }
    }

    if (isSecond) {
        db.prepare('UPDATE polls SET reminder_2_sent = 1 WHERE id = ?').run(pollId);
    } else {
        db.prepare('UPDATE polls SET reminder_sent = 1 WHERE id = ?').run(pollId);
    }
}

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
        SELECT pr.response, pr.reason, COALESCE(NULLIF(c.name_override, ''), c.name) AS name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ?
    `).all(pollId);

    const yes = responses.filter((row) => row.response === 'yes').map((row) => ({ name: row.name, reason: row.reason }));
    const no = responses.filter((row) => row.response === 'no').map((row) => ({ name: row.name, reason: row.reason }));
    const maybe = responses.filter((row) => row.response === 'maybe').map((row) => ({ name: row.name, reason: row.reason }));
    const pending = responses.filter((row) => !row.response).map((row) => ({ name: row.name }));
    const resultPostMode = getResultPostMode();
    let sentAnything = false;

    let resultMessageId = null;
    if (resultPostMode === 'text' || resultPostMode === 'both') {
        const resultResponse = await evolution.postResultsToGroup(
            GROUP_CHAT_ID,
            poll.title,
            poll.event_date,
            poll.event_time,
            poll.end_time,
            yes,
            no,
            maybe,
            pending,
            poll.meeting_time,
            cancelInfo,
            poll.description
        );
        resultMessageId = extractMessageId(resultResponse);
        sentAnything = true;
    }

    if (resultPostMode === 'image' || resultPostMode === 'both') {
        try {
            const imageBuffer = generateResultChart(poll.title, poll.event_date, yes.length, no.length, maybe.length, pending.length);
            const fmtDate = (date) => {
                const [year, month, day] = date.split('-');
                return `${day}.${month}.${year}`;
            };
            const imageResponse = await evolution.sendResultImage(
                GROUP_CHAT_ID,
                imageBuffer,
                `📊 Abstimmung: ${poll.title} - ${fmtDate(poll.event_date)}`
            );
            if (!resultMessageId) {
                resultMessageId = extractMessageId(imageResponse);
            }
            sentAnything = true;
        } catch (err) {
            console.error('[ERROR] sendResultImage:', err.message);
        }
    }

    if (!sentAnything) {
        throw new Error('Ergebnis konnte weder als Text noch als Bild gepostet werden');
    }

    if (markPosted) {
        db.prepare('UPDATE polls SET group_posted = 1, result_message_id = ? WHERE id = ?').run(resultMessageId, pollId);
    } else if (resultMessageId) {
        db.prepare('UPDATE polls SET result_message_id = ? WHERE id = ?').run(resultMessageId, pollId);
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

    if (updated > 0) scheduleImportantDescriptionUpdate();
    return updated;
}

async function resendPoll(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.description, e.event_time, e.end_time, e.meeting_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) throw new Error(`Poll ${pollId} not found`);
    if (poll.status !== 'active') throw new Error('Nur aktive Umfragen koennen neu gesendet werden');
    if (!GROUP_CHAT_ID) throw new Error('GROUP_CHAT_ID not configured');

    if (poll.poll_message_id) {
        evolution.unpinMessage(GROUP_CHAT_ID, poll.poll_message_id)
            .catch((err) => console.error('[ERROR] unpinMessage old poll:', err.message));
    }

    db.prepare('UPDATE poll_responses SET response = NULL, reason = NULL, responded_at = NULL WHERE poll_id = ?').run(pollId);
    db.prepare('UPDATE polls SET reminder_sent = 0, reminder_2_sent = 0 WHERE id = ?').run(pollId);

    await syncGroupParticipants();
    await syncPollRecipientsToCurrentGroup(pollId);

    const pollResult = await evolution.sendPollMessage(
        GROUP_CHAT_ID,
        poll.title,
        poll.event_date,
        poll.event_time,
        poll.end_time,
        poll.meeting_time,
        poll.description
    );
    const pollMessageId = extractMessageId(pollResult);

    db.prepare("UPDATE polls SET poll_message_id = ?, sent_at = datetime('now') WHERE id = ?").run(pollMessageId, pollId);

    await reconcilePinnedActivePoll();

    console.log(`[INFO] Poll ${pollId} resent (reset + new WhatsApp poll)`);
    scheduleImportantDescriptionUpdate();
}

async function closePoll(pollId) {
    const poll = db.prepare('SELECT poll_message_id FROM polls WHERE id = ?').get(pollId);
    db.prepare("UPDATE polls SET status = 'closed' WHERE id = ? AND status = 'active'").run(pollId);

    if (poll?.poll_message_id && GROUP_CHAT_ID) {
        try {
            await evolution.unpinMessage(GROUP_CHAT_ID, poll.poll_message_id);
        } catch (err) {
            console.error('[ERROR] unpinMessage poll:', err.message);
        }
    }
    await reconcilePinnedActivePoll();
    scheduleImportantDescriptionUpdate();
}

function extendDeadline(pollId, minutes) {
    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) throw new Error(`Poll ${pollId} not found`);
    if (poll.status === 'closed') throw new Error('Geschlossene Umfragen koennen nicht verlaengert werden');

    const current = new Date(poll.deadline);
    const newDeadline = new Date(current.getTime() + minutes * 60 * 1000);
    db.prepare('UPDATE polls SET deadline = ?, reminder_sent = 0, reminder_2_sent = 0 WHERE id = ?')
        .run(newDeadline.toISOString(), pollId);
    scheduleImportantDescriptionUpdate();
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
        SELECT c.phone, COALESCE(NULLIF(c.name_override, ''), c.name) AS name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ? AND pr.response = 'yes'
    `).all(pollId);

    const minutes = poll.event_reminder_minutes ?? 60;
    for (const row of yesResponses) {
        try {
            await evolution.sendEventReminder(
                toPrivateChatId(row.phone),
                poll.title,
                poll.event_time,
                poll.end_time,
                poll.meeting_time,
                poll.description,
                minutes
            );
        } catch (err) {
            console.error(`Failed to send event reminder to ${row.name}:`, err.message);
        }
    }

    db.prepare('UPDATE polls SET event_reminder_sent = 1 WHERE id = ?').run(pollId);
}

function ensureNextRecurringPoll(eventId, currentEventDate) {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event || !event.recurring || !event.active) return null;

    let nextDate = currentEventDate ? addDays(currentEventDate, 7) : null;
    if (!nextDate) return null;

    for (let attempts = 0; attempts < 52; attempts++) {
        const exception = db.prepare(
            'SELECT id FROM event_exceptions WHERE event_id = ? AND exception_date = ?'
        ).get(event.id, nextDate);
        const existing = db.prepare(
            'SELECT id FROM polls WHERE event_id = ? AND event_date = ?'
        ).get(event.id, nextDate);

        if (!exception && !existing) {
            const pollId = createPollForEvent(
                event.id,
                nextDate,
                event.poll_deadline_minutes,
                event.poll_send_minutes_before
            );
            console.log(`[INFO] Created next recurring poll ${pollId} for event ${event.id} on ${nextDate}`);
            return pollId;
        }

        if (!existing && exception) {
            nextDate = addDays(nextDate, 7);
            continue;
        }

        return existing?.id || null;
    }

    return null;
}

async function finalizeClosedPoll(pollId, options = {}) {
    const { postResults = false, suppressAutoPost = false } = options;
    const poll = db.prepare('SELECT event_id, event_date FROM polls WHERE id = ?').get(pollId);
    if (!poll) throw new Error(`Poll ${pollId} not found`);

    await closePoll(pollId);

    if (suppressAutoPost) {
        db.prepare('UPDATE polls SET group_posted = 1 WHERE id = ?').run(pollId);
    }

    let posted = false;
    if (postResults) {
        const event = db.prepare(`
            SELECT e.auto_cancel, e.min_participants
            FROM polls p JOIN events e ON p.event_id = e.id
            WHERE p.id = ?
        `).get(pollId);

        let cancelInfo = null;
        if (event?.auto_cancel && event.min_participants > 0) {
            const yesCount = db.prepare(
                "SELECT COUNT(*) as cnt FROM poll_responses WHERE poll_id = ? AND response = 'yes'"
            ).get(pollId).cnt;
            if (yesCount < event.min_participants) {
                cancelInfo = { yesCount, min: event.min_participants };
            }
        }

        await postGroupResults(pollId, cancelInfo, { markPosted: true });
        posted = true;
    }

    const nextPollId = ensureNextRecurringPoll(poll.event_id, poll.event_date);
    return { posted, nextPollId };
}

module.exports = {
    syncGroupParticipants,
    syncPollRecipientsToCurrentGroup,
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
    ensureNextRecurringPoll,
    finalizeClosedPoll,
    reconcilePinnedActivePoll,
    shouldSendReasonRequestDm,
};
