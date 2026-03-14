const WAHA_API_URL = process.env.WAHA_API_URL || 'http://localhost:3000';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

// Capability cache — null = untested, true/false = known
let capButtons = null;
let capImage   = null;

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

// Send poll to group: buttons if supported, native WA poll otherwise.
// Result is cached after first attempt — no repeated probing.
async function sendPollButtons(chatId, eventTitle, eventDate, eventTime) {
    if (capButtons === false) {
        console.log('[INFO] sendPollButtons: buttons not supported → using native poll');
        return sendPollMessage(chatId, eventTitle, eventDate, eventTime);
    }

    const body =
        `🗳️ *${eventTitle}*\n` +
        `📅 ${eventDate} um ${eventTime} Uhr\n\n` +
        `Kannst du dabei sein?`;
    try {
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
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        capButtons = true;
        console.log('[INFO] sendPollButtons: buttons supported ✓');
        return res.json();
    } catch (err) {
        capButtons = false;
        console.log(`[INFO] sendPollButtons: buttons not supported (${err.message}) → switching to native poll`);
        return sendPollMessage(chatId, eventTitle, eventDate, eventTime);
    }
}

// Send reminder with buttons if supported, plain text otherwise (uses same capButtons cache).
async function sendReminderWithButtons(chatId, eventTitle, eventDate, eventTime, deadlineTime) {
    if (capButtons === false) {
        return sendReminder(chatId, eventTitle, eventDate, eventTime, deadlineTime);
    }

    const body = `⏰ *Erinnerung: ${eventTitle}*\n📅 ${eventDate} um ${eventTime} Uhr\n\nAbstimmung endet um ${deadlineTime} Uhr!`;
    try {
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
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        capButtons = true;
        return res.json();
    } catch (err) {
        capButtons = false;
        console.log(`[INFO] sendReminderWithButtons: not supported (${err.message}) → plain text`);
        return sendReminder(chatId, eventTitle, eventDate, eventTime, deadlineTime);
    }
}

// Send result chart image. Tries multipart then JSON base64.
// Result is cached — if WAHA doesn't support it, skips silently forever.
async function sendResultImage(chatId, imageBuffer, caption) {
    if (capImage === false) {
        console.log('[INFO] sendResultImage: not supported by this WAHA instance, skipping');
        return null;
    }

    // Attempt 1: multipart/form-data
    try {
        const form = new FormData();
        form.append('session', WAHA_SESSION);
        form.append('chatId', chatId);
        form.append('caption', caption || '');
        form.append('file', new Blob([imageBuffer], { type: 'image/png' }), 'ergebnis.png');
        const res = await fetch(`${WAHA_API_URL}/api/sendFile`, {
            method: 'POST',
            headers: WAHA_API_KEY ? { 'X-Api-Key': WAHA_API_KEY } : {},
            body: form,
        });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        capImage = true;
        console.log('[INFO] sendResultImage: supported ✓ (multipart)');
        return res.json();
    } catch (err1) {
        console.log('[INFO] sendResultImage multipart failed:', err1.message, '— trying JSON base64');
    }

    // Attempt 2: JSON with base64
    try {
        const res = await fetch(`${WAHA_API_URL}/api/sendFile`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                session: WAHA_SESSION,
                chatId,
                file: { mimetype: 'image/png', filename: 'ergebnis.png', data: imageBuffer.toString('base64') },
                caption: caption || '',
            }),
        });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        capImage = true;
        console.log('[INFO] sendResultImage: supported ✓ (JSON base64)');
        return res.json();
    } catch (err2) {
        capImage = false;
        console.log(`[INFO] sendResultImage: not supported by this WAHA instance (${err2.message}) — chart will be text-only`);
        return null;
    }
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
