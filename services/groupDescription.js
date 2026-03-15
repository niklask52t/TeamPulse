const db = require('../db/database');
const waha = require('./waha');

const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';
const MAX_DESC_LENGTH = 2048;
const FOOTER = '─────────────────\nPowered by TeamPulse by Niklas Kronig\nBei Änderungswünschen/Anfragen: Niklas Kronig kontaktieren';

function fmtDate(dateStr) {
    if (!dateStr || !dateStr.includes('-')) return dateStr || '';
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}.${y}`;
}

function buildDescription() {
    // 1. Static blocks
    const aboveBlocks = db.prepare(
        "SELECT content FROM group_description_blocks WHERE position = 'above' ORDER BY sort_order ASC, id ASC"
    ).all();
    const belowBlocks = db.prepare(
        "SELECT content FROM group_description_blocks WHERE position = 'below' ORDER BY sort_order ASC, id ASC"
    ).all();

    // 2. Find next upcoming poll (non-archived, closest event_date in future)
    const nextPoll = db.prepare(`
        SELECT p.*, e.title, e.event_time, e.meeting_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.archived = 0 AND p.status IN ('pending', 'active', 'closed')
        ORDER BY p.event_date ASC, e.event_time ASC
        LIMIT 1
    `).get();

    // 3. Build dynamic section
    let dynamic = '';
    if (nextPoll) {
        const statusLabels = { pending: 'Ausstehend', active: 'Abstimmung läuft', closed: 'Geschlossen' };
        dynamic += `📅 Nächstes Event: ${nextPoll.title}\n`;
        dynamic += `🗓 ${fmtDate(nextPoll.event_date)} um ${nextPoll.event_time} Uhr\n`;
        if (nextPoll.meeting_time) {
            dynamic += `🤝 Treffen: ${nextPoll.meeting_time} Uhr\n`;
        }
        dynamic += `📊 Status: ${statusLabels[nextPoll.status] || nextPoll.status}\n`;
        dynamic += '\n';

        const responses = db.prepare(`
            SELECT pr.response, pr.reason, c.name
            FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
            WHERE pr.poll_id = ?
            ORDER BY c.name
        `).all(nextPoll.id);

        const yes = responses.filter(r => r.response === 'yes');
        const no = responses.filter(r => r.response === 'no');
        const maybe = responses.filter(r => r.response === 'maybe');
        const pending = responses.filter(r => !r.response);

        dynamic += `✅ Zusagen (${yes.length}): ${yes.map(r => r.name).join(', ') || '—'}\n`;
        dynamic += `❌ Absagen (${no.length}): ${no.map(r => r.name + (r.reason ? ` (${r.reason})` : '')).join(', ') || '—'}\n`;
        dynamic += `🤷 Vielleicht (${maybe.length}): ${maybe.map(r => r.name + (r.reason ? ` (${r.reason})` : '')).join(', ') || '—'}\n`;
        dynamic += `⏳ Ausstehend (${pending.length}): ${pending.map(r => r.name).join(', ') || '—'}`;
    } else {
        dynamic = 'Kein anstehendes Event.';
    }

    // 4. Assemble
    const parts = [];
    if (aboveBlocks.length) parts.push(aboveBlocks.map(b => b.content).join('\n\n'));
    parts.push(dynamic);
    if (belowBlocks.length) parts.push(belowBlocks.map(b => b.content).join('\n\n'));
    parts.push(FOOTER);

    let result = parts.join('\n\n');

    // Truncate if over WhatsApp limit
    if (result.length > MAX_DESC_LENGTH) {
        result = result.slice(0, MAX_DESC_LENGTH - 3) + '...';
    }

    return result;
}

// Debounce: avoid spamming WAHA when multiple votes come in quickly
let updateTimer = null;

function scheduleDescriptionUpdate() {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
        updateTimer = null;
        updateGroupDescription();
    }, 60000);
}

async function updateGroupDescription() {
    if (!GROUP_CHAT_ID) {
        console.warn('[WARN] GROUP_CHAT_ID not set, skipping description update');
        return;
    }
    try {
        const description = buildDescription();
        await waha.updateGroupDescription(GROUP_CHAT_ID, description);
        console.log('[INFO] Group description updated');
    } catch (err) {
        console.error('[ERROR] updateGroupDescription:', err.message);
    }
}

module.exports = { buildDescription, updateGroupDescription, scheduleDescriptionUpdate };
