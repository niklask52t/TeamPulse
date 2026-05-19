const db = require('../db/database');
const evolution = require('./evolution');
const { parseBerlinDateTime } = require('./timeUtils');

const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';
const MAX_DESC_LENGTH = 2048;
const SECTION_SEPARATOR = '\u2500'.repeat(17);
const FOOTER = `${SECTION_SEPARATOR}\nPowered by TeamPulse by Niklas Kronig\nBei Änderungswünschen/Anfragen: Niklas Kronig kontaktieren`;
const MAX_ACTIVE_IN_DESC = 1;
const DESCRIPTION_DEBOUNCE_MS = 30 * 1000;
const IMPORTANT_DESCRIPTION_DEBOUNCE_MS = 5 * 1000;
const SLOW_MODE_LAST_RUN_KEY = 'description_slow_mode_last_run_date';

let voteTimer = null;
let blockTimer = null;
let importantTimer = null;

function getSetting(key, fallback = null) {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row?.value ?? fallback;
}

function setSetting(key, value) {
    db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, String(value));
}

function asBool(value, fallback = false) {
    if (value == null) return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function getSlowModeEnabled() {
    return asBool(getSetting('description_slow_mode_enabled', '0'), false);
}

function getSlowModeTime() {
    const value = String(getSetting('description_slow_mode_time', '04:00') || '04:00').trim();
    return /^\d{2}:\d{2}$/.test(value) ? value : '04:00';
}

function berlinDateStr() {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).split(' ')[0];
}

function berlinMinutesOfDay(date = new Date()) {
    const parts = new Intl.DateTimeFormat('de-DE', {
        timeZone: 'Europe/Berlin',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    return (hour * 60) + minute;
}

function timeStringToMinutes(value) {
    const [hour, minute] = String(value || '04:00').split(':').map(Number);
    return (hour * 60) + minute;
}

function fmtDate(dateStr) {
    if (!dateStr || !dateStr.includes('-')) return dateStr || '';
    const [y, m, d] = dateStr.split('-');
    const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    return `${d}.${m}.${y} (${dayNames[dow]})`;
}

function buildCompactPollSummary(poll) {
    const responses = db.prepare(`
        SELECT response FROM poll_responses WHERE poll_id = ?
    `).all(poll.id);
    const y = responses.filter((r) => r.response === 'yes').length;
    const n = responses.filter((r) => r.response === 'no').length;
    const m = responses.filter((r) => r.response === 'maybe').length;
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

    const yes = responses.filter((r) => r.response === 'yes');
    const no = responses.filter((r) => r.response === 'no');
    const maybe = responses.filter((r) => r.response === 'maybe');
    const pending = responses.filter((r) => !r.response);

    let block = `✅ Zusagen (${yes.length}): ${yes.map((r) => r.name + (r.reason ? ` (${r.reason})` : '')).join(', ') || '—'}\n`;
    block += `❌ Absagen (${no.length}): ${no.map((r) => r.name + (r.reason ? ` (${r.reason})` : '')).join(', ') || '—'}\n`;
    block += `🤷 Vielleicht (${maybe.length}): ${maybe.map((r) => r.name + (r.reason ? ` (${r.reason})` : '')).join(', ') || '—'}\n`;
    block += `⏳ Ausstehend (${pending.length}): ${pending.map((r) => r.name).join(', ') || '—'}`;
    return block;
}

function buildPollHeader(poll) {
    const statusLabels = { pending: 'Ausstehend', active: 'Abstimmung läuft', closed: 'Ergebnis' };
    let header = `📌 ${poll.title}\n`;
    let timeStr = poll.event_time;
    if (poll.end_time) timeStr += ` - ${poll.end_time}`;
    header += `🗓 ${fmtDate(poll.event_date)} um ${timeStr} Uhr\n`;
    if (poll.meeting_time) header += `🤝 Treffen: ${poll.meeting_time} Uhr\n`;
    if (poll.description) header += `📝 ${poll.description}\n`;
    header += `📊 Status: ${statusLabels[poll.status] || poll.status}`;
    return header;
}

function buildDescription() {
    const aboveBlocks = db.prepare(
        "SELECT content FROM group_description_blocks WHERE position = 'above' ORDER BY sort_order ASC, id ASC"
    ).all();
    const belowBlocks = db.prepare(
        "SELECT content FROM group_description_blocks WHERE position = 'below' ORDER BY sort_order ASC, id ASC"
    ).all();

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

    const upcomingPolls = pollCandidates.filter((poll) => {
        const relevantTime = poll.end_time || poll.event_time;
        const eventEnd = parseBerlinDateTime(poll.event_date, relevantTime);
        return Number.isNaN(eventEnd.getTime()) || now < eventEnd;
    });

    const closedPolls = upcomingPolls.filter((poll) => poll.status === 'closed');
    const activePolls = upcomingPolls.filter((poll) => poll.status === 'active');
    const shownPolls = [
        ...closedPolls.slice(0, MAX_ACTIVE_IN_DESC),
        ...activePolls.slice(0, Math.max(0, MAX_ACTIVE_IN_DESC - closedPolls.length)),
    ];

    const nextPendingPoll = upcomingPolls.find((poll) => poll.status === 'pending') || null;
    const dynamicParts = [];

    for (const poll of shownPolls) {
        dynamicParts.push(buildPollHeader(poll) + '\n\n' + buildPollResponseBlock(poll));
    }

    const shownIds = new Set(shownPolls.map((poll) => poll.id));
    const extraActivePolls = activePolls.filter((poll) => !shownIds.has(poll.id));
    if (extraActivePolls.length > 0) {
        const lines = ['📋 Weitere aktive Umfragen:'];
        for (const poll of extraActivePolls) {
            lines.push(buildCompactPollSummary(poll));
        }
        dynamicParts.push(lines.join('\n'));
    }

    if (nextPendingPoll) {
        dynamicParts.push(buildPollHeader(nextPendingPoll));
    }

    const dynamic = dynamicParts.length > 0 ? dynamicParts.join('\n\n') : 'Kein anstehendes Event.';

    const allShownIds = new Set([...shownPolls.map((poll) => poll.id), ...extraActivePolls.map((poll) => poll.id)]);
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

    const upcomingEvents = upcomingCandidates.filter((poll) => {
        if (allShownIds.has(poll.id)) return false;
        const relevantTime = poll.end_time || poll.event_time;
        const eventEnd = parseBerlinDateTime(poll.event_date, relevantTime);
        return Number.isNaN(eventEnd.getTime()) || now < eventEnd;
    }).slice(0, 3);

    let upcoming = '';
    if (upcomingEvents.length > 0) {
        upcoming = '📋 Nächste Events:\n';
        for (const event of upcomingEvents) {
            upcoming += `• ${event.title} – ${fmtDate(event.event_date)}, ${event.event_time}`;
            if (event.end_time) upcoming += ` - ${event.end_time}`;
            upcoming += ' Uhr\n';
        }
    }

    const parts = [];
    if (aboveBlocks.length) parts.push(`${aboveBlocks.map((block) => block.content).join('\n\n')}\n${SECTION_SEPARATOR}`);
    parts.push(dynamic);
    if (upcoming) parts.push(upcoming.trim());
    if (belowBlocks.length) parts.push(`${SECTION_SEPARATOR}\n${belowBlocks.map((block) => block.content).join('\n\n')}`);
    parts.push(FOOTER);

    let result = parts.join('\n\n');
    if (result.length > MAX_DESC_LENGTH) {
        result = result.slice(0, MAX_DESC_LENGTH - 3) + '...';
    }

    return result;
}

function scheduleDescriptionUpdate() {
    if (getSlowModeEnabled()) return false;
    if (voteTimer) clearTimeout(voteTimer);
    voteTimer = setTimeout(() => {
        voteTimer = null;
        updateGroupDescription();
    }, DESCRIPTION_DEBOUNCE_MS);
    return true;
}

function scheduleImportantDescriptionUpdate() {
    if (importantTimer) clearTimeout(importantTimer);
    importantTimer = setTimeout(() => {
        importantTimer = null;
        updateGroupDescription();
    }, IMPORTANT_DESCRIPTION_DEBOUNCE_MS);
    return true;
}

function scheduleBlockDescriptionUpdate() {
    if (blockTimer) clearTimeout(blockTimer);
    blockTimer = setTimeout(() => {
        blockTimer = null;
        updateGroupDescription();
    }, IMPORTANT_DESCRIPTION_DEBOUNCE_MS);
    return true;
}

async function runSlowDescriptionUpdateIfDue() {
    if (!getSlowModeEnabled()) return false;

    const today = berlinDateStr();
    const lastRunDate = getSetting(SLOW_MODE_LAST_RUN_KEY, '');
    if (lastRunDate === today) return false;

    const nowMinutes = berlinMinutesOfDay();
    const targetMinutes = timeStringToMinutes(getSlowModeTime());
    if (nowMinutes < targetMinutes) return false;

    await updateGroupDescription();
    setSetting(SLOW_MODE_LAST_RUN_KEY, today);
    console.log('[INFO] Slow description mode daily update executed');
    return true;
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

module.exports = {
    buildDescription,
    updateGroupDescription,
    scheduleDescriptionUpdate,
    scheduleImportantDescriptionUpdate,
    scheduleBlockDescriptionUpdate,
    runSlowDescriptionUpdateIfDue,
};
