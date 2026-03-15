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

// Format YYYY-MM-DD → DD.MM.YYYY (Mo) for human-readable WhatsApp messages
function fmtDate(dateStr) {
    if (!dateStr || !dateStr.includes('-')) return dateStr || '';
    const [y, m, d] = dateStr.split('-');
    const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    return `${d}.${m}.${y} (${dayNames[dow]})`;
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

async function sendPollMessage(chatId, eventTitle, eventDate, eventTime, endTime, meetingTime, description) {
    const url = `${WAHA_API_URL}/api/sendPoll`;
    let name = `${eventTitle} – ${fmtDate(eventDate)} um ${eventTime}`;
    if (endTime) name += ` - ${endTime}`;
    name += ' Uhr';
    if (meetingTime) name += ` (Treffen: ${meetingTime} Uhr)`;
    if (description) name += `\n📝 ${description}`;
    name += '\n💬 Privat antworten für Kommentar';
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
async function sendReminder(chatId, eventTitle, eventDate, eventTime, endTime, deadlineTime, meetingTime, description) {
    let timeStr = eventTime;
    if (endTime) timeStr += ` - ${endTime}`;
    let text =
        `⏰ *Erinnerung: ${eventTitle}*\n` +
        `📅 ${fmtDate(eventDate)} um ${timeStr} Uhr\n`;
    if (meetingTime) text += `🤝 Treffen: ${meetingTime} Uhr\n`;
    if (description) text += `📝 ${description}\n`;
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
    let text =
        `🏃 *${eventTitle} beginnt in ${timeLabel}!*\n` +
        `⏰ ${timeStr} Uhr\n`;
    if (meetingTime) text += `🤝 Treffen: ${meetingTime} Uhr\n`;
    if (description) text += `📝 ${description}\n`;
    text += `\nBis gleich!`;
    return sendMessage(chatId, text);
}

// yesData/noData/maybeData: arrays of { name, reason? }
async function postResultsToGroup(groupId, eventTitle, eventDate, eventTime, endTime, yesData, noData, maybeData, meetingTime, cancelInfo, description) {
    let timeStr = eventTime;
    if (endTime) timeStr += ` - ${endTime}`;
    const lines = [`📊 *Ergebnis: ${eventTitle}*`, `📅 ${fmtDate(eventDate)} um ${timeStr} Uhr`];
    if (meetingTime) lines.push(`🤝 Treffen: ${meetingTime} Uhr`);
    if (description) lines.push(`📝 ${description}`);

    if (cancelInfo) {
        lines.push('');
        lines.push(`❌ *ABGESAGT — zu wenige Zusagen (${cancelInfo.yesCount}/${cancelInfo.min})*`);
    }
    lines.push('');

    const fmtEntry = (r) => r.reason ? `${r.name} (${r.reason})` : r.name;

    lines.push(`✅ *Zusagen (${yesData.length}):*`);
    lines.push(yesData.length ? yesData.map(fmtEntry).join(', ') : '—');
    lines.push('');

    lines.push(`❌ *Absagen (${noData.length}):*`);
    lines.push(noData.length ? noData.map(fmtEntry).join(', ') : '—');
    lines.push('');

    if (maybeData.length) {
        lines.push(`🤷 *Vielleicht (${maybeData.length}):*`);
        lines.push(maybeData.map(fmtEntry).join(', '));
        lines.push('');
    }

    lines.push(`Total: ${yesData.length + noData.length + maybeData.length} Antworten`);

    return sendMessage(groupId, lines.join('\n'));
}

async function sendCancellationMessage(chatId, eventTitle, eventDate, eventTime, endTime, yesCount, minRequired, meetingTime, description) {
    let timeStr = eventTime;
    if (endTime) timeStr += ` - ${endTime}`;
    let text =
        `❌ *ABGESAGT: ${eventTitle}*\n` +
        `📅 ${fmtDate(eventDate)} um ${timeStr} Uhr\n`;
    if (meetingTime) text += `🤝 Treffen: ${meetingTime} Uhr\n`;
    if (description) text += `📝 ${description}\n`;
    text += `\nZu wenige Zusagen (${yesCount}/${minRequired}).`;
    return sendMessage(chatId, text);
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

async function sendAdminVoteNotification(chatId, eventTitle, eventDate, newResponse) {
    const labels = { yes: 'Zusagen ✅', no: 'Absagen ❌', maybe: 'Vielleicht 🤷' };
    const label = labels[newResponse] || newResponse;
    const text =
        `ℹ️ Deine Stimme für *${eventTitle}* am ${fmtDate(eventDate)} wurde vom Admin zu *${label}* geändert.\n\n` +
        `Optional: Schreib innerhalb von *5 Minuten* einen Kommentar — oder ignoriere diese Nachricht.`;
    return sendMessage(chatId, text);
}

async function sendTooLateNotification(chatId, eventTitle, eventDate) {
    const text =
        `⏰ Die Abstimmung für *${eventTitle}* am ${fmtDate(eventDate)} ist bereits beendet.\n\n` +
        `Deine Stimme konnte leider nicht mehr gezählt werden. Wende dich bei Fragen an den Admin.`;
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

// Update group description — retries with delay to handle WAHA Store.GroupMetadata caching
async function updateGroupDescription(groupId, description) {
    const url = `${WAHA_API_URL}/api/${WAHA_SESSION}/groups/${groupId}/description`;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Preload group metadata into whatsapp-web.js Store before each attempt
        try {
            const preloadUrl = `${WAHA_API_URL}/api/${WAHA_SESSION}/groups/${groupId}`;
            await fetch(preloadUrl, { headers: getHeaders });
        } catch { /* ignore preload errors */ }

        // Wait a bit after preload so WAHA's Store can cache the metadata
        if (attempt > 1) {
            await new Promise(r => setTimeout(r, attempt * 3000));
        }

        const res = await fetch(url, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ description }),
        });

        if (res.ok) return res.json();

        const body = await res.text();
        const isMetadataError = body.includes("Cannot read properties of undefined (reading 'get')");

        if (isMetadataError && attempt < maxAttempts) {
            console.warn(`[WARN] updateGroupDescription attempt ${attempt}/${maxAttempts} failed (Store not ready), retrying...`);
            continue;
        }

        throw new Error(`WAHA updateGroupDescription failed (${res.status}): ${body.slice(0, 300)}`);
    }
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
    sendAdminVoteNotification,
    sendTooLateNotification,
    postResultsToGroup,
    sendCancellationMessage,
    getGroupParticipants,
    getAllContacts,
    getGroups,
    getContactById,
    updateGroupDescription,
};
