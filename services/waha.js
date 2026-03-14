const WAHA_API_URL = process.env.WAHA_API_URL || 'http://localhost:3000';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

// Capability flags — set once at startup via detectCapabilities()
let capButtons = false;
let capImage   = false;

// Engines known to support interactive buttons and file/image sending
const ENGINES_WITH_BUTTONS = ['WEBJS', 'VENOM'];
const ENGINES_WITH_IMAGE   = ['WEBJS', 'VENOM', 'NOWEB'];

async function detectCapabilities() {
    try {
        const res = await fetch(`${WAHA_API_URL}/api/sessions/${WAHA_SESSION}`, { headers: getHeaders });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Engine field location varies by WAHA version
        const engine = (
            data.engine?.engine || data.config?.engine || data.engine || ''
        ).toUpperCase().trim();

        capButtons = ENGINES_WITH_BUTTONS.includes(engine);
        capImage   = ENGINES_WITH_IMAGE.includes(engine);

        console.log(`[WAHA] Engine: ${engine || '(unknown)'} | buttons: ${capButtons} | image: ${capImage}`);
    } catch (err) {
        console.warn(`[WAHA] detectCapabilities failed: ${err.message} — defaulting buttons=false image=false`);
    }
}

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

// Send poll to group: buttons (WEBJS/VENOM) or native WA poll (NOWEB).
async function sendPollButtons(chatId, eventTitle, eventDate, eventTime) {
    if (!capButtons) {
        return sendPollMessage(chatId, eventTitle, eventDate, eventTime);
    }

    const body =
        `🗳️ *${eventTitle}*\n` +
        `📅 ${eventDate} um ${eventTime} Uhr\n\n` +
        `Kannst du dabei sein?`;
    const res = await fetch(`${WAHA_API_URL}/api/sendButtons`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            session: WAHA_SESSION,
            chatId,
            body,
            buttons: [
                { id: 'yes',   body: 'Ja ✅' },
                { id: 'no',    body: 'Nein ❌' },
                { id: 'maybe', body: 'Vielleicht 🤷' },
            ],
        }),
    });
    if (!res.ok) {
        const b = await res.text();
        throw new Error(`WAHA sendButtons failed (${res.status}): ${b}`);
    }
    return res.json();
}

// Send reminder: buttons (WEBJS/VENOM) or plain text (NOWEB).
async function sendReminderWithButtons(chatId, eventTitle, eventDate, eventTime, deadlineTime) {
    if (!capButtons) {
        return sendReminder(chatId, eventTitle, eventDate, eventTime, deadlineTime);
    }

    const body = `⏰ *Erinnerung: ${eventTitle}*\n📅 ${eventDate} um ${eventTime} Uhr\n\nAbstimmung endet um ${deadlineTime} Uhr!`;
    const res = await fetch(`${WAHA_API_URL}/api/sendButtons`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            session: WAHA_SESSION,
            chatId,
            body,
            buttons: [
                { id: 'yes',   body: 'Ja ✅' },
                { id: 'no',    body: 'Nein ❌' },
                { id: 'maybe', body: 'Vielleicht 🤷' },
            ],
        }),
    });
    if (!res.ok) {
        const b = await res.text();
        throw new Error(`WAHA sendButtons failed (${res.status}): ${b}`);
    }
    return res.json();
}

// Send result chart image — only called when capImage=true (WEBJS/VENOM/NOWEB).
async function sendResultImage(chatId, imageBuffer, caption) {
    if (!capImage) return null;

    // Try multipart/form-data first, then JSON base64
    const apiKey = WAHA_API_KEY ? { 'X-Api-Key': WAHA_API_KEY } : {};
    const form = new FormData();
    form.append('session', WAHA_SESSION);
    form.append('chatId', chatId);
    form.append('caption', caption || '');
    form.append('file', new Blob([imageBuffer], { type: 'image/png' }), 'ergebnis.png');
    const r1 = await fetch(`${WAHA_API_URL}/api/sendFile`, { method: 'POST', headers: apiKey, body: form });
    if (r1.ok) return r1.json();

    // JSON base64 fallback
    const r2 = await fetch(`${WAHA_API_URL}/api/sendFile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            session: WAHA_SESSION,
            chatId,
            file: { mimetype: 'image/png', filename: 'ergebnis.png', data: imageBuffer.toString('base64') },
            caption: caption || '',
        }),
    });
    if (!r2.ok) {
        const b = await r2.text();
        throw new Error(`WAHA sendFile failed (${r2.status}): ${b}`);
    }
    return r2.json();
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

async function sendMaybeFollowUp(chatId, eventTitle, eventDate) {
    const text =
        `🤷 Du hast mit *Vielleicht* abgestimmt für *${eventTitle}* am ${eventDate}.\n\n` +
        `Optional: Schreib einfach kurz warum (z.B. "Komme evtl. zu spät", "Weiß noch nicht") — oder ignoriere diese Nachricht.`;
    return sendMessage(chatId, text);
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
    detectCapabilities,
    sendMessage,
    sendPollMessage,
    sendPollButtons,
    sendReminder,
    sendReminderWithButtons,
    sendResultImage,
    sendEventReminder,
    sendMaybeFollowUp,
    postResultsToGroup,
    getGroupParticipants,
    getAllContacts,
};
