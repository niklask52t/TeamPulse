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

// Format YYYY-MM-DD → DD.MM.YYYY for human-readable WhatsApp messages
function fmtDate(dateStr) {
    if (!dateStr || !dateStr.includes('-')) return dateStr || '';
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}.${y}`;
}

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

async function sendPollMessage(chatId, eventTitle, eventDate, eventTime, meetingTime) {
    const url = `${WAHA_API_URL}/api/sendPoll`;
    let name = `${eventTitle} – ${fmtDate(eventDate)} um ${eventTime} Uhr`;
    if (meetingTime) name += ` (Treffen: ${meetingTime} Uhr)`;
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            session: WAHA_SESSION,
            chatId,
            poll: {
                name,
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
async function sendReminder(chatId, eventTitle, eventDate, eventTime, deadlineTime, meetingTime) {
    let text =
        `⏰ *Erinnerung: ${eventTitle}*\n` +
        `📅 ${fmtDate(eventDate)} um ${eventTime} Uhr\n`;
    if (meetingTime) text += `🤝 Treffen: ${meetingTime} Uhr\n`;
    text += `\nDie Abstimmung endet um ${deadlineTime} Uhr!\n` +
        `Falls noch nicht abgestimmt, jetzt in der Umfrage antworten.`;
    return sendMessage(chatId, text);
}

// Send result chart image — tries multipart/form-data first, then JSON base64.
async function sendResultImage(chatId, imageBuffer, caption) {
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

async function sendEventReminder(chatId, eventTitle, eventTime, meetingTime) {
    let text =
        `🏃 *${eventTitle} beginnt in 1 Stunde!*\n` +
        `⏰ ${eventTime} Uhr\n`;
    if (meetingTime) text += `🤝 Treffen: ${meetingTime} Uhr\n`;
    text += `\nBis gleich!`;
    return sendMessage(chatId, text);
}

async function postResultsToGroup(groupId, eventTitle, eventDate, eventTime, yesNames, noNames, maybeNames, meetingTime) {
    const lines = [`📊 *Ergebnis: ${eventTitle}*`, `📅 ${fmtDate(eventDate)} um ${eventTime} Uhr`];
    if (meetingTime) lines.push(`🤝 Treffen: ${meetingTime} Uhr`);
    lines.push('');

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
        `🤷 Du hast mit *Vielleicht* abgestimmt für *${eventTitle}* am ${fmtDate(eventDate)}.\n\n` +
        `Optional: Schreib innerhalb von *5 Minuten* kurz warum (z.B. "Komme evtl. zu spät", "Weiß noch nicht") — oder ignoriere diese Nachricht.`;
    return sendMessage(chatId, text);
}

async function sendNoFollowUp(chatId, eventTitle, eventDate) {
    const text =
        `❌ Du hast für *${eventTitle}* am ${fmtDate(eventDate)} abgesagt.\n\n` +
        `Optional: Schreib innerhalb von *5 Minuten* kurz den Grund (z.B. "Krank", "Keine Zeit") — oder ignoriere diese Nachricht.`;
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

// Get all groups the session is part of
async function getGroups() {
    const url = `${WAHA_API_URL}/api/${WAHA_SESSION}/groups`;
    const res = await fetch(url, { headers: getHeaders });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`WAHA getGroups failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

// Update group description — tries multiple WAHA endpoint shapes
async function updateGroupDescription(groupId, description) {
    const endpoints = [
        // WAHA Plus / newer versions: PUT with chatId in body
        {
            url: `${WAHA_API_URL}/api/${WAHA_SESSION}/groups/description`,
            method: 'PUT',
            body: { chatId: groupId, description },
        },
        // Path-based endpoint
        {
            url: `${WAHA_API_URL}/api/${WAHA_SESSION}/groups/${groupId}/description`,
            method: 'PUT',
            body: { description },
        },
        // Some versions use settings sub-path
        {
            url: `${WAHA_API_URL}/api/${WAHA_SESSION}/groups/${groupId}/settings`,
            method: 'PUT',
            body: { description },
        },
    ];

    let lastError = '';
    for (const ep of endpoints) {
        try {
            const res = await fetch(ep.url, {
                method: ep.method,
                headers,
                body: JSON.stringify(ep.body),
            });
            if (res.ok) {
                return await res.json();
            }
            const body = await res.text();
            lastError = `${ep.url} (${res.status}): ${body.slice(0, 200)}`;
            // 404 = endpoint doesn't exist, try next; 500 = internal error, also try next
            console.log(`[WARN] updateGroupDescription attempt failed: ${lastError}`);
        } catch (err) {
            lastError = `${ep.url}: ${err.message}`;
        }
    }
    throw new Error(`WAHA updateGroupDescription all attempts failed. Last: ${lastError}`);
}

// Get a single contact by ID (can be @c.us or @lid) — tries multiple WAHA endpoint shapes
async function getContactById(contactId) {
    // Try WAHA Plus endpoint first
    const endpoints = [
        `${WAHA_API_URL}/api/${WAHA_SESSION}/contacts/${encodeURIComponent(contactId)}`,
        `${WAHA_API_URL}/api/contacts?session=${WAHA_SESSION}&contactId=${encodeURIComponent(contactId)}`,
        `${WAHA_API_URL}/api/${WAHA_SESSION}/contacts/check-exists`,
    ];
    for (const url of endpoints.slice(0, 2)) {
        try {
            const res = await fetch(url, { headers: getHeaders });
            if (res.ok) {
                const data = await res.json();
                if (data && (data.id || data.phone || data.number)) return data;
            }
        } catch { /* try next */ }
    }
    // Try check-exists with POST
    try {
        const res = await fetch(endpoints[2], {
            method: 'POST',
            headers,
            body: JSON.stringify({ session: WAHA_SESSION, phone: contactId }),
        });
        if (res.ok) {
            const data = await res.json();
            if (data) return data;
        }
    } catch { /* ignore */ }
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
    postResultsToGroup,
    getGroupParticipants,
    getAllContacts,
    getGroups,
    getContactById,
    updateGroupDescription,
};
