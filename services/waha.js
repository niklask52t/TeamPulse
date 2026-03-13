const WAHA_API_URL = process.env.WAHA_API_URL || 'http://localhost:3000';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

const headers = {
    'Content-Type': 'application/json',
    ...(WAHA_API_KEY && { 'X-Api-Key': WAHA_API_KEY }),
};

async function sendMessage(chatId, text) {
    const url = `${WAHA_API_URL}/api/sendText`;
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            session: WAHA_SESSION,
            chatId,
            text,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`WAHA sendText failed (${res.status}): ${body}`);
    }
    return res.json();
}

async function sendPollMessage(chatId, eventTitle, eventDate, eventTime) {
    const text =
        `📋 *Umfrage: ${eventTitle}*\n` +
        `📅 ${eventDate} um ${eventTime}\n\n` +
        `Kommst du? Antworte mit:\n` +
        `👍 *Ja*\n` +
        `👎 *Nein*\n` +
        `🤷 *Vielleicht*`;
    return sendMessage(chatId, text);
}

async function sendReminder(chatId, eventTitle, eventDate, eventTime, minutesLeft) {
    const text =
        `⏰ *Erinnerung: ${eventTitle}*\n` +
        `📅 ${eventDate} um ${eventTime}\n\n` +
        `Die Abstimmung endet in ${minutesLeft} Minuten!\n` +
        `Falls noch nicht geantwortet, bitte jetzt antworten (Ja/Nein/Vielleicht).`;
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
    const lines = [`📊 *Ergebnis: ${eventTitle}*`, `📅 ${eventDate} um ${eventTime}`, ''];

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

    const noResponse = [];
    lines.push(`Total: ${yesNames.length + noNames.length + maybeNames.length} Antworten`);

    return sendMessage(groupId, lines.join('\n'));
}

module.exports = {
    sendMessage,
    sendPollMessage,
    sendReminder,
    sendEventReminder,
    postResultsToGroup,
};
