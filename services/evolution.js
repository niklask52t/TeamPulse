const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || 'http://localhost:8080').replace(/\/+$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'teampulse';
const EVOLUTION_TIMEOUT_MS = Number(process.env.EVOLUTION_TIMEOUT_MS || 20000);

const jsonHeaders = {
    'Content-Type': 'application/json',
    ...(EVOLUTION_API_KEY && { apikey: EVOLUTION_API_KEY }),
};

let warnedAboutPinning = false;
const AUTO_HINT = '_Automatisch generierte Nachricht von TeamPulse_ 🤖';

function normalizeRecipient(value) {
    if (!value) return '';
    if (typeof value === 'object') {
        const nested = value._serialized
            || value.id
            || value.jid
            || value.remoteJid
            || value.user
            || (value.user && value.server ? `${value.user}@${value.server}` : '')
            || '';
        return normalizeRecipient(nested);
    }
    const text = String(value).trim();
    if (text.endsWith('@g.us') || text.endsWith('@s.whatsapp.net') || text.endsWith('@lid')) {
        return text;
    }
    return text.replace(/^\+/, '').replace(/\D/g, '');
}

async function evolutionFetch(path, options = {}) {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || EVOLUTION_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = path.startsWith('http') ? path : `${EVOLUTION_API_URL}${path}`;

    try {
        const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
        const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
        // fetch() resolves once headers arrive; the body is a lazy stream. Read it here while the
        // abort timer is still armed, otherwise a stalled body would hang past EVOLUTION_TIMEOUT_MS.
        res._bodyText = await res.text();
        return res;
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`Evolution request timed out after ${timeoutMs}ms: ${options.method || 'GET'} ${url}`);
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

async function parseResponse(res, label) {
    const text = res._bodyText !== undefined ? res._bodyText : await res.text();
    if (!res.ok) {
        throw new Error(`Evolution ${label} failed (${res.status}): ${text}`);
    }
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function fmtDate(dateStr) {
    if (!dateStr || !dateStr.includes('-')) return dateStr || '';
    const [y, m, d] = dateStr.split('-');
    const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    return `${dayNames[dow]}, ${d}.${m}.${y}`;
}

function formatEventWindow(eventTime, endTime) {
    if (!eventTime) return '';
    return endTime ? `${eventTime}–${endTime} Uhr` : `${eventTime} Uhr`;
}

function cleanLine(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

// Shared emoji info block used by all group messages: date, time window, meeting time, description
function buildEventInfoLines(eventDate, eventTime, endTime, meetingTime, description) {
    const lines = [];
    if (eventDate) lines.push(`🗓 ${fmtDate(eventDate)}`);
    const window = formatEventWindow(eventTime, endTime);
    if (window) lines.push(`🕒 ${window}`);
    if (meetingTime) lines.push(`🤝 Treffen: ${meetingTime} Uhr`);
    const desc = cleanLine(description);
    if (desc) lines.push(`📝 ${desc}`);
    return lines;
}

function buildPollText(eventTitle, eventDate, eventTime, endTime, meetingTime, description) {
    return [
        `📋 *${cleanLine(eventTitle)}*`,
        '',
        ...buildEventInfoLines(eventDate, eventTime, endTime, meetingTime, description),
        '',
        'Bitte stimmt unten ab. 👇',
        '',
        AUTO_HINT,
    ].join('\n');
}

async function sendTextMessage(chatId, text) {
    const res = await evolutionFetch(`/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
            number: normalizeRecipient(chatId),
            text,
            linkPreview: true,
        }),
    });
    return parseResponse(res, 'sendText');
}

async function sendMessage(chatId, text) {
    return sendTextMessage(chatId, text);
}

async function sendPollMessage(chatId, eventTitle, eventDate, eventTime, endTime, meetingTime, description) {
    const res = await evolutionFetch(`/message/sendPoll/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
            number: normalizeRecipient(chatId),
            name: buildPollText(eventTitle, eventDate, eventTime, endTime, meetingTime, description),
            selectableCount: 1,
            values: ['Ja', 'Nein', 'Vielleicht'],
        }),
    });
    return parseResponse(res, 'sendPoll');
}

async function sendResultImage(chatId, imageBuffer, caption) {
    const res = await evolutionFetch(`/message/sendMedia/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
            number: normalizeRecipient(chatId),
            mediatype: 'image',
            mimetype: 'image/png',
            caption: caption || '',
            media: imageBuffer.toString('base64'),
            fileName: 'ergebnis.png',
        }),
    });
    return parseResponse(res, 'sendMedia');
}

// Group message reminding everyone who has not voted yet (replaces the old per-person DMs)
async function sendDeadlineReminderToGroup(groupId, eventTitle, eventDate, eventTime, endTime, deadlineTime, meetingTime, description, pendingNames = []) {
    const lines = [
        '⏰ *Erinnerung: Abstimmung läuft noch*',
        '',
        `📋 *${cleanLine(eventTitle)}*`,
        ...buildEventInfoLines(eventDate, eventTime, endTime, meetingTime, description),
    ];
    if (pendingNames.length) {
        lines.push('', `⏳ *Noch keine Stimme von (${pendingNames.length}):*`, pendingNames.join(', '));
    }
    lines.push('', `Bitte stimmt bis *${deadlineTime} Uhr* ab. 🙏`, '', AUTO_HINT);
    return sendMessage(groupId, lines.join('\n'));
}

// Group message shortly before the event starts, listing everyone who said yes (replaces the old per-person DMs)
async function sendEventReminderToGroup(groupId, eventTitle, eventTime, endTime, meetingTime, description, minutesBefore, yesNames = []) {
    const mins = minutesBefore || 60;
    let timeLabel;
    if (mins >= 60 && mins % 60 === 0) {
        const h = mins / 60;
        timeLabel = h === 1 ? '1 Stunde' : `${h} Stunden`;
    } else if (mins >= 60) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        timeLabel = `${h}h ${m}min`;
    } else {
        timeLabel = `${mins} Minuten`;
    }

    const lines = [
        `🔔 *${cleanLine(eventTitle)}* startet in *${timeLabel}*!`,
        '',
        ...buildEventInfoLines(null, eventTime, endTime, meetingTime, description),
    ];
    if (yesNames.length) {
        lines.push('', `✅ *Dabei sind (${yesNames.length}):*`, yesNames.join(', '));
    }
    lines.push('', 'Bis gleich! 💪', '', AUTO_HINT);
    return sendMessage(groupId, lines.join('\n'));
}

async function postResultsToGroup(groupId, eventTitle, eventDate, eventTime, endTime, yesNames, noNames, maybeNames, pendingNames, meetingTime, cancelInfo, description) {
    const lines = [
        `📊 *Ergebnis: ${cleanLine(eventTitle)}*`,
        '',
        ...buildEventInfoLines(eventDate, eventTime, endTime, meetingTime, description),
    ];

    if (cancelInfo) {
        lines.push('', `🚫 *Abgesagt* — zu wenige Zusagen (${cancelInfo.yesCount}/${cancelInfo.min})`);
    }

    lines.push('', `✅ *Zusagen (${yesNames.length})*`, yesNames.join(', ') || '—');
    lines.push('', `❌ *Absagen (${noNames.length})*`, noNames.join(', ') || '—');
    if (maybeNames.length) {
        lines.push('', `🤷 *Vielleicht (${maybeNames.length})*`, maybeNames.join(', '));
    }
    if (pendingNames && pendingNames.length) {
        lines.push('', `⏳ *Keine Antwort (${pendingNames.length})*`, pendingNames.join(', '));
    }

    const total = yesNames.length + noNames.length + maybeNames.length;
    const all = total + (pendingNames ? pendingNames.length : 0);
    lines.push('', `📈 ${total} von ${all} haben abgestimmt`, '', AUTO_HINT);

    return sendMessage(groupId, lines.join('\n'));
}

async function sendCancellationMessage(chatId, eventTitle, eventDate, eventTime, endTime, yesCount, minRequired, meetingTime, description) {
    const lines = [
        `🚫 *Absage: ${cleanLine(eventTitle)}*`,
        '',
        ...buildEventInfoLines(eventDate, eventTime, endTime, meetingTime, description),
        '',
        `Leider gibt es zu wenige Zusagen (${yesCount}/${minRequired}) — das Event fällt aus.`,
        '',
        AUTO_HINT,
    ];
    return sendMessage(chatId, lines.join('\n'));
}

function extractRecords(data, seen = new Set()) {
    if (!data || seen.has(data)) return [];
    if (Array.isArray(data)) return data;
    if (typeof data !== 'object') return [];

    seen.add(data);

    const directKeys = [
        'participants',
        'participant',
        'members',
        'groupParticipants',
        'contacts',
        'groups',
        'records',
        'rows',
        'data',
        'result',
        'response',
        'payload',
    ];

    for (const key of directKeys) {
        if (Array.isArray(data[key])) return data[key];
    }

    const nestedKeys = ['data', 'result', 'response', 'payload'];
    for (const key of nestedKeys) {
        const nested = data[key];
        const extracted = extractRecords(nested, seen);
        if (extracted.length) return extracted;
    }

    return [];
}

function extractGroupId(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    return normalizeRecipient(
        entry.id
        || entry.jid
        || entry.remoteJid
        || entry.groupJid
        || entry.subjectOwner
        || entry.key?.remoteJid
        || entry.key?.id
        || entry._serialized
        || ''
    );
}

function extractParticipantsFromGroup(entry) {
    if (!entry || typeof entry !== 'object') return [];
    return extractRecords(
        entry.participants
        || entry.members
        || entry.groupParticipants
        || entry.data
        || entry.result
        || entry
    );
}

async function getGroupParticipants(groupId) {
    const url = `/group/participants/${encodeURIComponent(EVOLUTION_INSTANCE)}?groupJid=${encodeURIComponent(groupId)}`;
    const res = await evolutionFetch(url, { headers: EVOLUTION_API_KEY ? { apikey: EVOLUTION_API_KEY } : {} });
    const data = await parseResponse(res, 'groupParticipants');
    const directParticipants = extractRecords(data);
    if (directParticipants.length) return directParticipants;

    const groups = await getGroups(true);
    const normalizedGroupId = normalizeRecipient(groupId);
    const group = groups.find((entry) => extractGroupId(entry) === normalizedGroupId);
    return extractParticipantsFromGroup(group);
}

async function getAllContacts() {
    const res = await evolutionFetch(`/chat/findContacts/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ where: {} }),
    });
    const data = await parseResponse(res, 'findContacts');
    return extractRecords(data);
}

async function getGroups(withParticipants = false) {
    const res = await evolutionFetch(`/group/fetchAllGroups/${encodeURIComponent(EVOLUTION_INSTANCE)}?getParticipants=${withParticipants}`, {
        headers: EVOLUTION_API_KEY ? { apikey: EVOLUTION_API_KEY } : {},
    });
    const data = await parseResponse(res, 'fetchAllGroups');
    return extractRecords(data);
}

async function getContactById(contactId) {
    const res = await evolutionFetch(`/chat/findContacts/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ where: { id: contactId } }),
    });
    const data = await parseResponse(res, 'findContactById');
    const records = extractRecords(data);
    if (records.length) return records[0] || null;
    return data || null;
}

async function updateGroupDescription(groupId, description) {
    const res = await evolutionFetch(`/group/updateGroupDescription/${encodeURIComponent(EVOLUTION_INSTANCE)}?groupJid=${encodeURIComponent(groupId)}`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ description }),
    });
    return parseResponse(res, 'updateGroupDescription');
}

async function pinMessage(chatId, messageId) {
    if (!warnedAboutPinning) {
        console.warn('[WARN] Evolution API has no documented pin/unpin endpoint in v2 docs. Message pinning is skipped.');
        warnedAboutPinning = true;
    }
    return null;
}

async function unpinMessage(chatId, messageId) {
    if (!warnedAboutPinning) {
        console.warn('[WARN] Evolution API has no documented pin/unpin endpoint in v2 docs. Message unpinning is skipped.');
        warnedAboutPinning = true;
    }
    return null;
}

module.exports = {
    sendMessage,
    sendPollMessage,
    sendResultImage,
    sendDeadlineReminderToGroup,
    sendEventReminderToGroup,
    postResultsToGroup,
    sendCancellationMessage,
    getGroupParticipants,
    getAllContacts,
    getGroups,
    getContactById,
    updateGroupDescription,
    pinMessage,
    unpinMessage,
};
