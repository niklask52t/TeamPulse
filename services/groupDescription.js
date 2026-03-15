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
        SELECT p.*, e.title, e.description, e.event_time, e.end_time, e.meeting_time
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
        let timeStr = nextPoll.event_time;
        if (nextPoll.end_time) timeStr += ` - ${nextPoll.end_time}`;
        dynamic += `🗓 ${fmtDate(nextPoll.event_date)} um ${timeStr} Uhr\n`;
        if (nextPoll.meeting_time) {
            dynamic += `🤝 Treffen: ${nextPoll.meeting_time} Uhr\n`;
        }
        if (nextPoll.description) {
            dynamic += `📝 ${nextPoll.description}\n`;
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

        dynamic += `✅ Zusagen (${yes.length}): ${yes.map(r => r.name + (r.reason ? ` (${r.reason})` : '')).join(', ') || '—'}\n`;
        dynamic += `❌ Absagen (${no.length}): ${no.map(r => r.name + (r.reason ? ` (${r.reason})` : '')).join(', ') || '—'}\n`;
        dynamic += `🤷 Vielleicht (${maybe.length}): ${maybe.map(r => r.name + (r.reason ? ` (${r.reason})` : '')).join(', ') || '—'}\n`;
        dynamic += `⏳ Ausstehend (${pending.length}): ${pending.map(r => r.name).join(', ') || '—'}`;
    } else {
        dynamic = 'Kein anstehendes Event.';
    }

    // 4. Next 3 upcoming events (excluding the one already shown)
    const excludeId = nextPoll ? nextPoll.id : -1;
    const upcomingEvents = db.prepare(`
        SELECT p.event_date, e.title, e.event_time, e.end_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.archived = 0 AND p.id != ?
        AND p.event_date >= date('now')
        ORDER BY p.event_date ASC, e.event_time ASC
        LIMIT 3
    `).all(excludeId);

    let upcoming = '';
    if (upcomingEvents.length > 0) {
        upcoming = '📋 Nächste Events:\n';
        for (const ev of upcomingEvents) {
            upcoming += `• ${ev.title} – ${fmtDate(ev.event_date)}, ${ev.event_time}`;
            if (ev.end_time) upcoming += ` - ${ev.end_time}`;
            upcoming += ' Uhr\n';
        }
    }

    // 5. Assemble
    const parts = [];
    if (aboveBlocks.length) parts.push(aboveBlocks.map(b => b.content).join('\n\n'));
    parts.push(dynamic);
    if (belowBlocks.length) parts.push(belowBlocks.map(b => b.content).join('\n\n'));
    if (upcoming) parts.push(upcoming.trim());
    parts.push(FOOTER);

    let result = parts.join('\n\n');

    // Truncate if over WhatsApp limit
    if (result.length > MAX_DESC_LENGTH) {
        result = result.slice(0, MAX_DESC_LENGTH - 3) + '...';
    }

    return result;
}

// Debounce timers for different contexts
let voteTimer = null;
let blockTimer = null;

// 15s debounce for votes/poll changes
function scheduleDescriptionUpdate() {
    if (voteTimer) clearTimeout(voteTimer);
    voteTimer = setTimeout(() => {
        voteTimer = null;
        updateGroupDescription();
    }, 15000);
}

// 120s debounce for text block changes
function scheduleBlockDescriptionUpdate() {
    if (blockTimer) clearTimeout(blockTimer);
    blockTimer = setTimeout(() => {
        blockTimer = null;
        updateGroupDescription();
    }, 120000);
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

module.exports = { buildDescription, updateGroupDescription, scheduleDescriptionUpdate, scheduleBlockDescriptionUpdate };
