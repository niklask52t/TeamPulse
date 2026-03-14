const WAHA_API_URL = process.env.WAHA_API_URL || 'http://localhost:3000';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

const headers = {
    'Content-Type': 'application/json',
    ...(WAHA_API_KEY && { 'X-Api-Key': WAHA_API_KEY }),
};

const getHeaders = {
    ...(WAHA_API_KEY && { 'X-Api-Key': WAHA_API_KEY }),
};

async function sendMessage(chatId, text) {
    const url = `${WAHA_API_URL}/api/sendText`;
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ session: WAHA_SESSION, chatId, text }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`WAHA sendText failed (${res.status}): ${body}`);
    }
    return res.json();
}

async function sendPollMessage(chatId, eventTitle, eventDate, eventTime) {
    const url = `${WAHA_API_URL}/api/sendPoll`;
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            session: WAHA_SESSION,
            chatId,
            poll: {
                name: `${eventTitle} – ${eventDate} um ${eventTime} Uhr`,
                options: ['Ja ✅', 'Nein ❌', 'Vielleicht 🤷'],
                multipleAnswers: false,
            },
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`WAHA sendPoll failed (${res.status}): ${body}`);
    }
    return res.json();
}

// deadlineTime: formatted time string, e.g. "18:00 Uhr"
async function sendReminder(chatId, eventTitle, eventDate, eventTime, deadlineTime) {
    const text =
        `⏰ *Erinnerung: ${eventTitle}*\n` +
        `📅 ${eventDate} um ${eventTime} Uhr\n\n` +
        `Die Abstimmung endet um ${deadlineTime} Uhr!\n` +
        `Falls noch nicht abgestimmt, jetzt in der Umfrage antworten.`;
    return sendMessage(chatId, text);
}

async function sendEventReminder(chatId, eventTitle, eventTime) {
    const text =
        `🏃 *${eventTitle} beginnt in 1 Stunde!*\n` +
        `⏰ ${eventTime} Uhr\n\n` +
        `Bis gleich!`;
    return sendMessage(chatId, text);
}

async function postResultsToGroup(groupId, eventTitle, eventDate, eventTime, yesNames, noNames, maybeNames) {
    const lines = [`📊 *Ergebnis: ${eventTitle}*`, `📅 ${eventDate} um ${eventTime} Uhr`, ''];

    lines.push(`✅ *Zusagen (${yesNames.length}):*`);
    lines.push(yesNames.length ? yesNames.join(', ') : '—');
    lines.push('');

    lines.push(`❌ *Absagen (${noNames.length}):*`);
    lines.push(noNames.length ? noNames.join(', ') : '—');
    lines.push('');

    if (maybeNames.length) {
        lines.push(`🤷 *Vielleicht (${maybeNames.length}):*`);
        lines.push(maybeNames.join(', '));
        lines.push('');
    }

    lines.push(`Total: ${yesNames.length + noNames.length + maybeNames.length} Antworten`);

    return sendMessage(groupId, lines.join('\n'));
}

// Get all participants of a group
async function getGroupParticipants(groupId) {
    const url = `${WAHA_API_URL}/api/${WAHA_SESSION}/groups/${encodeURIComponent(groupId)}/participants/v2`;
    const res = await fetch(url, { headers: getHeaders });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`WAHA getGroupParticipants failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    // Handle both array and { participants: [...] } response shapes
    return Array.isArray(data) ? data : (data.participants || []);
}

// Get all contacts known to WAHA (for name resolution)
async function getAllContacts() {
    const url = `${WAHA_API_URL}/api/contacts/all?session=${WAHA_SESSION}`;
    const res = await fetch(url, { headers: getHeaders });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`WAHA getAllContacts failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : (data.contacts || []);
}

module.exports = {
    sendMessage,
    sendPollMessage,
    sendReminder,
    sendEventReminder,
    postResultsToGroup,
    getGroupParticipants,
    getAllContacts,
};
