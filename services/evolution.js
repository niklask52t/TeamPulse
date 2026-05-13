const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || 'http://localhost:8080').replace(/\/+$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'teampulse';
const EVOLUTION_TIMEOUT_MS = Number(process.env.EVOLUTION_TIMEOUT_MS || 20000);

const jsonHeaders = {
    'Content-Type': 'application/json',
    ...(EVOLUTION_API_KEY && { apikey: EVOLUTION_API_KEY }),
};

let warnedAboutPinning = false;
const AUTO_HINT = '_Automatisch generierte Nachricht von TeamPulse_';

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
        return await fetch(url, { ...fetchOptions, signal: controller.signal });
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
    const text = await res.text();
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
    return `${d}.${m}.${y} (${dayNames[dow]})`;
}

function formatEventWindow(eventTime, endTime) {
    if (!eventTime) return '';
    return endTime ? `${eventTime} - ${endTime} Uhr` : `${eventTime} Uhr`;
}

function cleanLine(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function pushField(lines, label, value, options = {}) {
    const clean = cleanLine(value);
    if (!clean) return;
    if (options.italic) {
        lines.push(`${label} _${clean}_`);
        return;
    }
    if (options.bold) {
        lines.push(`${label} *${clean}*`);
        return;
    }
    lines.push(`${label} ${clean}`);
}

function buildPollText(eventTitle, eventDate, eventTime, endTime, meetingTime, description) {
    const lines = [
        `*${cleanLine(eventTitle)}*`,
        `Datum: ${fmtDate(eventDate)}`,
        `Zeit: ${formatEventWindow(eventTime, endTime)}`,
    ];
    pushField(lines, 'Treffen:', meetingTime ? `${meetingTime} Uhr` : '');
    pushField(lines, 'Info:', description, { italic: true });
    lines.push('', AUTO_HINT);
    return lines.join('\n');
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

async function sendReminder(chatId, eventTitle, eventDate, eventTime, endTime, deadlineTime, meetingTime, description) {
    const lines = [
        `*${cleanLine(eventTitle)}*`,
        `Datum: ${fmtDate(eventDate)}`,
        `Zeit: ${formatEventWindow(eventTime, endTime)}`,
    ];
    pushField(lines, 'Treffen:', meetingTime ? `${meetingTime} Uhr` : '');
    pushField(lines, 'Info:', description, { italic: true });
    lines.push('', `Bitte stimme bis *${deadlineTime} Uhr* in der Gruppe ab.`, '', AUTO_HINT);
    return sendMessage(chatId, lines.join('\n'));
}

async function sendEventReminder(chatId, eventTitle, eventTime, endTime, meetingTime, description, minutesBefore) {
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
        `*${cleanLine(eventTitle)}*`,
        `Startet in ${timeLabel}.`,
        '',
        `Zeit: ${formatEventWindow(eventTime, endTime)}`,
    ];
    pushField(lines, 'Treffen:', meetingTime ? `${meetingTime} Uhr` : '');
    pushField(lines, 'Info:', description, { italic: true });
    lines.push('', 'Bis gleich!', '', AUTO_HINT);
    return sendMessage(chatId, lines.join('\n'));
}

async function postResultsToGroup(groupId, eventTitle, eventDate, eventTime, endTime, yesData, noData, maybeData, pendingData, meetingTime, cancelInfo, description) {
    const lines = [
        `*${cleanLine(eventTitle)}*`,
        `Datum: ${fmtDate(eventDate)}`,
        `Zeit: ${formatEventWindow(eventTime, endTime)}`,
    ];
    pushField(lines, 'Treffen:', meetingTime ? `${meetingTime} Uhr` : '');
    pushField(lines, 'Info:', description, { italic: true });

    if (cancelInfo) {
        lines.push('');
        lines.push('*Abgesagt*');
        lines.push(`Zu wenige Zusagen (${cancelInfo.yesCount}/${cancelInfo.min})`);
    }
    lines.push('');

    const fmtEntry = (r) => r.reason ? `${r.name} (${r.reason})` : r.name;

    lines.push(`*Zusagen* (${yesData.length})`);
    lines.push(yesData.length ? yesData.map(fmtEntry).join(', ') : '-');
    lines.push('');

    lines.push(`*Absagen* (${noData.length})`);
    lines.push(noData.length ? noData.map(fmtEntry).join(', ') : '-');
    lines.push('');

    if (maybeData.length) {
        lines.push(`*Vielleicht* (${maybeData.length})`);
        lines.push(maybeData.map(fmtEntry).join(', '));
        lines.push('');
    }

    if (pendingData && pendingData.length) {
        lines.push(`*Noch offen* (${pendingData.length})`);
        lines.push(pendingData.map((r) => r.name).join(', '));
        lines.push('');
    }

    const total = yesData.length + noData.length + maybeData.length;
    const all = total + (pendingData ? pendingData.length : 0);
    lines.push(`Antworten: ${total}/${all}`);
    lines.push('', AUTO_HINT);

    return sendMessage(groupId, lines.join('\n'));
}

async function sendCancellationMessage(chatId, eventTitle, eventDate, eventTime, endTime, yesCount, minRequired, meetingTime, description) {
    const lines = [
        `*${cleanLine(eventTitle)}*`,
        `Datum: ${fmtDate(eventDate)}`,
        `Zeit: ${formatEventWindow(eventTime, endTime)}`,
    ];
    pushField(lines, 'Treffen:', meetingTime ? `${meetingTime} Uhr` : '');
    pushField(lines, 'Info:', description, { italic: true });
    lines.push('', `Zu wenige Zusagen (${yesCount}/${minRequired}).`, '', AUTO_HINT);
    return sendMessage(chatId, lines.join('\n'));
}

async function sendMaybeFollowUp(chatId, eventTitle, eventDate) {
    const text = [
        `Du hast fuer *${cleanLine(eventTitle)}* am ${fmtDate(eventDate)} mit _Vielleicht_ abgestimmt.`,
        '',
        'Optional: Schreib innerhalb von _5 Minuten_ kurz warum oder ignoriere diese Nachricht.',
        '',
        AUTO_HINT,
    ].join('\n');
    return sendMessage(chatId, text);
}

async function sendNoFollowUp(chatId, eventTitle, eventDate) {
    const text = [
        `Du hast fuer *${cleanLine(eventTitle)}* am ${fmtDate(eventDate)} abgesagt.`,
        '',
        'Optional: Schreib innerhalb von _5 Minuten_ kurz den Grund oder ignoriere diese Nachricht.',
        '',
        AUTO_HINT,
    ].join('\n');
    return sendMessage(chatId, text);
}

async function sendYesFollowUp(chatId, eventTitle, eventDate) {
    const text = [
        `Du hast fuer *${cleanLine(eventTitle)}* am ${fmtDate(eventDate)} zugesagt.`,
        '',
        'Optional: Schreib innerhalb von _5 Minuten_ einen Kommentar oder ignoriere diese Nachricht.',
        '',
        AUTO_HINT,
    ].join('\n');
    return sendMessage(chatId, text);
}

async function sendVoteChangeFollowUp(chatId, eventTitle, eventDate, newResponse, oldReason) {
    const labels = { yes: 'Zusage', no: 'Absage', maybe: 'Vielleicht' };
    const label = labels[newResponse] || newResponse;
    let text = `Du hast deine Stimme fuer *${cleanLine(eventTitle)}* am ${fmtDate(eventDate)} zu *${label}* geaendert.`;
    if (oldReason) {
        text += `\n\nDein vorheriger Kommentar war: _"${oldReason}"_`;
    }
    text += `\n\nOptional: Schreib innerhalb von _5 Minuten_ einen neuen Kommentar oder ignoriere diese Nachricht.\n\n${AUTO_HINT}`;
    return sendMessage(chatId, text);
}

async function sendAdminVoteNotification(chatId, eventTitle, eventDate, newResponse) {
    const labels = { yes: 'Zusage', no: 'Absage', maybe: 'Vielleicht' };
    const label = labels[newResponse] || newResponse;
    const text = [
        `Deine Stimme fuer *${cleanLine(eventTitle)}* am ${fmtDate(eventDate)} wurde vom Admin zu *${label}* geaendert.`,
        '',
        'Optional: Schreib innerhalb von _5 Minuten_ einen Kommentar oder ignoriere diese Nachricht.',
        '',
        AUTO_HINT,
    ].join('\n');
    return sendMessage(chatId, text);
}

async function sendTooLateNotification(chatId, eventTitle, eventDate) {
    const text = [
        `Die Abstimmung fuer *${cleanLine(eventTitle)}* am ${fmtDate(eventDate)} ist bereits beendet.`,
        '',
        'Deine Stimme konnte leider nicht mehr gezaehlt werden.',
        'Falls du doch anwesend warst, wende dich an *Niklas Kronig* - er kann deine Stimme nachtraeglich anpassen.',
        '',
        AUTO_HINT,
    ].join('\n');
    return sendMessage(chatId, text);
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
    sendReminder,
    sendResultImage,
    sendEventReminder,
    sendMaybeFollowUp,
    sendNoFollowUp,
    sendYesFollowUp,
    sendVoteChangeFollowUp,
    sendAdminVoteNotification,
    sendTooLateNotification,
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
