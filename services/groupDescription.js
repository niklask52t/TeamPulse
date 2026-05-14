const db = require('../db/database');
const evolution = require('./evolution');
const { parseBerlinDateTime } = require('./timeUtils');

const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';
const MAX_DESC_LENGTH = 2048;
const SECTION_SEPARATOR = '\u2500'.repeat(17);
const FOOTER = '─────────────────\nPowered by TeamPulse by Niklas Kronig\nBei Änderungswünschen/Anfragen: Niklas Kronig kontaktieren';

function fmtDate(dateStr) {
    if (!dateStr || !dateStr.includes('-')) return dateStr || '';
    const [y, m, d] = dateStr.split('-');
    const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    return `${d}.${m}.${y} (${dayNames[dow]})`;
}

const MAX_ACTIVE_IN_DESC = 1;

function buildCompactPollSummary(poll) {
    const responses = db.prepare(`
        SELECT response FROM poll_responses WHERE poll_id = ?
    `).all(poll.id);
    const y = responses.filter(r => r.response === 'yes').length;
    const n = responses.filter(r => r.response === 'no').length;
    const m = responses.filter(r => r.response === 'maybe').length;
    let timeStr = poll.event_time;
    if (poll.end_time) timeStr += ` - ${poll.end_time}`;
    return `🗳 ${poll.title} – ${fmtDate(poll.event_date)}, ${timeStr} Uhr — ✅${y} ❌${n} 🤷${m}`;
}

function buildPollResponseBlock(poll) {
    const responses = db.prepare(`
        SELECT pr.response, pr.reason, COALESCE(NULLIF(c.name_override, ''), c.name) AS name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ?
        ORDER BY COALESCE(NULLIF(c.name_override, ''), c.name)
    `).all(poll.id);

    const yes = responses.filter(r => r.response === 'yes');
    const no = responses.filter(r => r.response === 'no');
    const maybe = responses.filter(r => r.response === 'maybe');
    const pending = responses.filter(r => !r.response);

    let block = `✅ Zusagen (${yes.length}): ${yes.map(r => r.name + (r.reason ? ` (${r.reason})` : '')).join(', ') || '—'}\n`;
    block += `❌ Absagen (${no.length}): ${no.map(r => r.name + (r.reason ? ` (${r.reason})` : '')).join(', ') || '—'}\n`;
    block += `🤷 Vielleicht (${maybe.length}): ${maybe.map(r => r.name + (r.reason ? ` (${r.reason})` : '')).join(', ') || '—'}\n`;
    block += `⏳ Ausstehend (${pending.length}): ${pending.map(r => r.name).join(', ') || '—'}`;
    return block;
}

function buildPollHeader(poll) {
    const statusLabels = { pending: 'Ausstehend', active: 'Abstimmung läuft', closed: 'Ergebnis' };
    let header = `📅 ${poll.title}\n`;
    let timeStr = poll.event_time;
    if (poll.end_time) timeStr += ` - ${poll.end_time}`;
    header += `🗓 ${fmtDate(poll.event_date)} um ${timeStr} Uhr\n`;
    if (poll.meeting_time) header += `🤝 Treffen: ${poll.meeting_time} Uhr\n`;
    if (poll.description) header += `📝 ${poll.description}\n`;
    header += `📊 Status: ${statusLabels[poll.status] || poll.status}`;
    return header;
}

function buildDescription() {
    // 1. Static blocks
    const aboveBlocks = db.prepare(
        "SELECT content FROM group_description_blocks WHERE position = 'above' ORDER BY sort_order ASC, id ASC"
    ).all();
    const belowBlocks = db.prepare(
        "SELECT content FROM group_description_blocks WHERE position = 'below' ORDER BY sort_order ASC, id ASC"
    ).all();

    // 2. Find all upcoming polls (non-archived, event not yet ended)
    const now = new Date();
    const pollCandidates = db.prepare(`
        SELECT p.*, e.title, e.description, e.event_time, e.end_time, e.meeting_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.archived = 0 AND p.status IN ('pending', 'active', 'closed')
        AND NOT (
            p.status = 'pending' AND EXISTS (
                SELECT 1 FROM event_exceptions ex
                WHERE ex.event_id = p.event_id AND ex.exception_date = p.event_date
            )
        )
        ORDER BY p.event_date ASC, e.event_time ASC
    `).all();

    const upcomingPolls = pollCandidates.filter(p => {
        const relevantTime = p.end_time || p.event_time;
        const eventEnd = parseBerlinDateTime(p.event_date, relevantTime);
        return isNaN(eventEnd.getTime()) || now < eventEnd;
    });

    // 3. Separate polls by status
    // Closed polls whose event is still running get highest priority (results visible until event ends)
    const closedPolls = upcomingPolls.filter(p => p.status === 'closed');
    const activePolls = upcomingPolls.filter(p => p.status === 'active');

    // Closed polls take priority slots, then active polls fill remaining
    const shownPolls = [
        ...closedPolls.slice(0, MAX_ACTIVE_IN_DESC),
        ...activePolls.slice(0, Math.max(0, MAX_ACTIVE_IN_DESC - closedPolls.length))
    ];

    // Next pending poll (for event info only, no vote listing)
    const nextPendingPoll = upcomingPolls.find(p => p.status === 'pending') || null;

    // 4. Build dynamic section
    const dynamicParts = [];

    // Closed/active polls with full vote breakdown
    for (const poll of shownPolls) {
        dynamicParts.push(buildPollHeader(poll) + '\n\n' + buildPollResponseBlock(poll));
    }

    // Remaining active polls as compact one-liners with header
    const shownIds = new Set(shownPolls.map(p => p.id));
    const extraActivePolls = activePolls.filter(p => !shownIds.has(p.id));
    if (extraActivePolls.length > 0) {
        const lines = ['📋 Weitere aktive Umfragen:'];
        for (const poll of extraActivePolls) {
            lines.push(buildCompactPollSummary(poll));
        }
        dynamicParts.push(lines.join('\n'));
    }

    // Pending poll — event info only, no votes
    if (nextPendingPoll) {
        dynamicParts.push(buildPollHeader(nextPendingPoll));
    }

    const dynamic = dynamicParts.length > 0 ? dynamicParts.join('\n\n') : 'Kein anstehendes Event.';

    // 5. Next 3 upcoming events (excluding already shown polls)
    const allShownIds = new Set([...shownPolls.map(p => p.id), ...extraActivePolls.map(p => p.id)]);
    if (nextPendingPoll) allShownIds.add(nextPendingPoll.id);
    const upcomingCandidates = db.prepare(`
        SELECT p.id, p.event_date, e.title, e.event_time, e.end_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.archived = 0
        AND p.event_date >= date('now')
        AND NOT (
            p.status = 'pending' AND EXISTS (
                SELECT 1 FROM event_exceptions ex
                WHERE ex.event_id = p.event_id AND ex.exception_date = p.event_date
            )
        )
        ORDER BY p.event_date ASC, e.event_time ASC
    `).all();
    const upcomingEvents = upcomingCandidates.filter(p => {
        if (allShownIds.has(p.id)) return false;
        const relevantTime = p.end_time || p.event_time;
        const eventEnd = parseBerlinDateTime(p.event_date, relevantTime);
        return isNaN(eventEnd.getTime()) || now < eventEnd;
    }).slice(0, 3);

    let upcoming = '';
    if (upcomingEvents.length > 0) {
        upcoming = '📋 Nächste Events:\n';
        for (const ev of upcomingEvents) {
            upcoming += `• ${ev.title} – ${fmtDate(ev.event_date)}, ${ev.event_time}`;
            if (ev.end_time) upcoming += ` - ${ev.end_time}`;
            upcoming += ' Uhr\n';
        }
    }

    // 6. Assemble
    const parts = [];
    if (aboveBlocks.length) parts.push(`${aboveBlocks.map(b => b.content).join('\n\n')}\n${SECTION_SEPARATOR}`);
    parts.push(dynamic);
    if (upcoming) parts.push(upcoming.trim());
    if (belowBlocks.length) parts.push(`${SECTION_SEPARATOR}\n${belowBlocks.map(b => b.content).join('\n\n')}`);
    parts.push(FOOTER);

    let result = parts.join('\n\n');

    // Truncate if over WhatsApp limit
    if (result.length > MAX_DESC_LENGTH) {
        result = result.slice(0, MAX_DESC_LENGTH - 3) + '...';
    }

    return result;
}

const DESCRIPTION_DEBOUNCE_MS = 30 * 1000;

// Debounce timers for different contexts
let voteTimer = null;
let blockTimer = null;

// 30s debounce for votes/poll changes
function scheduleDescriptionUpdate() {
    if (voteTimer) clearTimeout(voteTimer);
    voteTimer = setTimeout(() => {
        voteTimer = null;
        updateGroupDescription();
    }, DESCRIPTION_DEBOUNCE_MS);
}

// 30s debounce for text block changes
function scheduleBlockDescriptionUpdate() {
    if (blockTimer) clearTimeout(blockTimer);
    blockTimer = setTimeout(() => {
        blockTimer = null;
        updateGroupDescription();
    }, DESCRIPTION_DEBOUNCE_MS);
}

async function updateGroupDescription() {
    if (!GROUP_CHAT_ID) {
        console.warn('[WARN] GROUP_CHAT_ID not set, skipping description update');
        return;
    }
    try {
        const description = buildDescription();
        await evolution.updateGroupDescription(GROUP_CHAT_ID, description);
        console.log('[INFO] Group description updated');
    } catch (err) {
        console.error('[ERROR] updateGroupDescription:', err.message);
    }
}

module.exports = { buildDescription, updateGroupDescription, scheduleDescriptionUpdate, scheduleBlockDescriptionUpdate };
