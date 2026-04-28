const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || 'http://localhost:8080').replace(/\/+$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'teampulse';
const EVOLUTION_TIMEOUT_MS = Number(process.env.EVOLUTION_TIMEOUT_MS || 20000);

const jsonHeaders = {
    'Content-Type': 'application/json',
    ...(EVOLUTION_API_KEY && { apikey: EVOLUTION_API_KEY }),
};

let warnedAboutPinning = false;

function normalizeRecipient(value) {
    if (!value) return '';
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
    let name = `${eventTitle} - ${fmtDate(eventDate)} um ${eventTime}`;
    if (endTime) name += ` - ${endTime}`;
    name += ' Uhr';
    if (meetingTime) name += ` (Treffen: ${meetingTime} Uhr)`;
    if (description) name += `\nNotiz: ${description}`;
    name += '\n\n_Automatisch generierte Nachricht von TeamPulse_';

    const res = await evolutionFetch(`/message/sendPoll/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
            number: normalizeRecipient(chatId),
            name,
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

const AUTO_HINT = '\n\n_Automatisch generierte Nachricht von TeamPulse_';

async function sendReminder(chatId, eventTitle, eventDate, eventTime, endTime, deadlineTime, meetingTime, description) {
    let timeStr = eventTime;
    if (endTime) timeStr += ` - ${endTime}`;
    let text =
        `Du hast noch nicht abgestimmt!\n\n` +
        `*${eventTitle}*\n` +
        `${fmtDate(eventDate)} um ${timeStr} Uhr\n`;
    if (meetingTime) text += `Treffen: ${meetingTime} Uhr\n`;
    if (description) text += `Notiz: ${description}\n`;
    text += `\nAbstimmung endet um *${deadlineTime} Uhr* - bitte jetzt in der Gruppe abstimmen.` + AUTO_HINT;
    return sendMessage(chatId, text);
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

    let timeStr = eventTime;
    if (endTime) timeStr += ` - ${endTime}`;
    let text = `*${eventTitle}* beginnt in ${timeLabel}!\n${timeStr} Uhr\n`;
    if (meetingTime) text += `Treffen: ${meetingTime} Uhr\n`;
    if (description) text += `Notiz: ${description}\n`;
    text += `\nBis gleich!` + AUTO_HINT;
    return sendMessage(chatId, text);
}

async function postResultsToGroup(groupId, eventTitle, eventDate, eventTime, endTime, yesData, noData, maybeData, pendingData, meetingTime, cancelInfo, description) {
    let timeStr = eventTime;
    if (endTime) timeStr += ` - ${endTime}`;
    const lines = [`*Ergebnis: ${eventTitle}*`, `${fmtDate(eventDate)} um ${timeStr} Uhr`];
    if (meetingTime) lines.push(`Treffen: ${meetingTime} Uhr`);
    if (description) lines.push(`Notiz: ${description}`);

    if (cancelInfo) {
        lines.push('');
        lines.push(`ABGESAGT - zu wenige Zusagen (${cancelInfo.yesCount}/${cancelInfo.min})`);
    }
    lines.push('');

    const fmtEntry = (r) => r.reason ? `${r.name} (${r.reason})` : r.name;

    lines.push(`Zusagen (${yesData.length}):`);
    lines.push(yesData.length ? yesData.map(fmtEntry).join(', ') : '-');
    lines.push('');

    lines.push(`Absagen (${noData.length}):`);
    lines.push(noData.length ? noData.map(fmtEntry).join(', ') : '-');
    lines.push('');

    if (maybeData.length) {
        lines.push(`Vielleicht (${maybeData.length}):`);
        lines.push(maybeData.map(fmtEntry).join(', '));
        lines.push('');
    }

    if (pendingData && pendingData.length) {
        lines.push(`Nicht abgestimmt (${pendingData.length}):`);
        lines.push(pendingData.map((r) => r.name).join(', '));
        lines.push('');
    }

    const total = yesData.length + noData.length + maybeData.length;
    const all = total + (pendingData ? pendingData.length : 0);
    lines.push(`Total: ${total}/${all} Antworten`);
    lines.push(AUTO_HINT);

    return sendMessage(groupId, lines.join('\n'));
}

async function sendCancellationMessage(chatId, eventTitle, eventDate, eventTime, endTime, yesCount, minRequired, meetingTime, description) {
    let timeStr = eventTime;
    if (endTime) timeStr += ` - ${endTime}`;
    let text = `*ABGESAGT: ${eventTitle}*\n${fmtDate(eventDate)} um ${timeStr} Uhr\n`;
    if (meetingTime) text += `Treffen: ${meetingTime} Uhr\n`;
    if (description) text += `Notiz: ${description}\n`;
    text += `\nZu wenige Zusagen (${yesCount}/${minRequired}).` + AUTO_HINT;
    return sendMessage(chatId, text);
}

async function sendMaybeFollowUp(chatId, eventTitle, eventDate) {
    const text =
        `Du hast mit *Vielleicht* abgestimmt fuer *${eventTitle}* am ${fmtDate(eventDate)}.\n\n` +
        `Optional: Schreib innerhalb von *5 Minuten* kurz warum - oder ignoriere diese Nachricht.` + AUTO_HINT;
    return sendMessage(chatId, text);
}

async function sendNoFollowUp(chatId, eventTitle, eventDate) {
    const text =
        `Du hast fuer *${eventTitle}* am ${fmtDate(eventDate)} abgesagt.\n\n` +
        `Optional: Schreib innerhalb von *5 Minuten* kurz den Grund - oder ignoriere diese Nachricht.` + AUTO_HINT;
    return sendMessage(chatId, text);
}

async function sendYesFollowUp(chatId, eventTitle, eventDate) {
    const text =
        `Du hast fuer *${eventTitle}* am ${fmtDate(eventDate)} zugesagt.\n\n` +
        `Optional: Schreib innerhalb von *5 Minuten* einen Kommentar - oder ignoriere diese Nachricht.` + AUTO_HINT;
    return sendMessage(chatId, text);
}

async function sendVoteChangeFollowUp(chatId, eventTitle, eventDate, newResponse, oldReason) {
    const labels = { yes: 'Zusagen', no: 'Absagen', maybe: 'Vielleicht' };
    const label = labels[newResponse] || newResponse;
    let text = `Du hast deine Stimme fuer *${eventTitle}* am ${fmtDate(eventDate)} zu *${label}* geaendert.`;
    if (oldReason) {
        text += `\n\nDein vorheriger Kommentar war: _"${oldReason}"_`;
    }
    text += `\n\nOptional: Schreib innerhalb von *5 Minuten* einen neuen Kommentar - oder ignoriere diese Nachricht.` + AUTO_HINT;
    return sendMessage(chatId, text);
}

async function sendAdminVoteNotification(chatId, eventTitle, eventDate, newResponse) {
    const labels = { yes: 'Zusagen', no: 'Absagen', maybe: 'Vielleicht' };
    const label = labels[newResponse] || newResponse;
    const text =
        `Deine Stimme fuer *${eventTitle}* am ${fmtDate(eventDate)} wurde vom Admin zu *${label}* geaendert.\n\n` +
        `Optional: Schreib innerhalb von *5 Minuten* einen Kommentar - oder ignoriere diese Nachricht.` + AUTO_HINT;
    return sendMessage(chatId, text);
}

async function sendTooLateNotification(chatId, eventTitle, eventDate) {
    const text =
        `Die Abstimmung fuer *${eventTitle}* am ${fmtDate(eventDate)} ist bereits beendet.\n\n` +
        `Deine Stimme konnte leider nicht mehr gezaehlt werden.\n` +
        `Falls du doch anwesend warst, wende dich an *Niklas Kronig* - er kann deine Stimme nachtraeglich anpassen.` + AUTO_HINT;
    return sendMessage(chatId, text);
}

async function getGroupParticipants(groupId) {
    const url = `/group/participants/${encodeURIComponent(EVOLUTION_INSTANCE)}?groupJid=${encodeURIComponent(groupId)}`;
    const res = await evolutionFetch(url, { headers: EVOLUTION_API_KEY ? { apikey: EVOLUTION_API_KEY } : {} });
    const data = await parseResponse(res, 'groupParticipants');
    return Array.isArray(data) ? data : (data?.participants || []);
}

async function getAllContacts() {
    const res = await evolutionFetch(`/chat/findContacts/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ where: {} }),
    });
    const data = await parseResponse(res, 'findContacts');
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.contacts)) return data.contacts;
    if (Array.isArray(data?.data)) return data.data;
    return [];
}

async function getGroups() {
    const res = await evolutionFetch(`/group/fetchAllGroups/${encodeURIComponent(EVOLUTION_INSTANCE)}?getParticipants=false`, {
        headers: EVOLUTION_API_KEY ? { apikey: EVOLUTION_API_KEY } : {},
    });
    const data = await parseResponse(res, 'fetchAllGroups');
    return Array.isArray(data) ? data : [];
}

async function getContactById(contactId) {
    const res = await evolutionFetch(`/chat/findContacts/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ where: { id: contactId } }),
    });
    const data = await parseResponse(res, 'findContactById');
    if (Array.isArray(data)) return data[0] || null;
    if (Array.isArray(data?.contacts)) return data.contacts[0] || null;
    if (Array.isArray(data?.data)) return data.data[0] || null;
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
