const cron = require('node-cron');
const db = require('../db/database');
const pollManager = require('./pollManager');
const { parseBerlinDateTime, TZ } = require('./timeUtils');

// Returns current date string (YYYY-MM-DD) in Europe/Berlin timezone
function berlinDateStr() {
    return new Date().toLocaleString('sv-SE', { timeZone: TZ }).split(' ')[0];
}

// Returns current day-of-week (0=Sun...6=Sat) in Europe/Berlin timezone
function berlinDayOfWeek() {
    return new Date(new Date().toLocaleString('sv-SE', { timeZone: TZ })).getDay();
}

// Add N days to a YYYY-MM-DD string (timezone-safe via noon UTC)
function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

function startScheduler() {
    cron.schedule('* * * * *', async () => {
        try {
            await checkAndSendPolls();
            await checkDeadlineReminders();
            await checkAndClosePolls();
            await checkGroupPosts();
            await checkEventReminders();
            await generateRecurringPolls();
            await archiveOldPolls();
        } catch (err) {
            console.error('[ERROR] Scheduler:', err);
        }
    });

    console.log('Scheduler started');
}

async function checkAndSendPolls() {
    const nowISO = new Date().toISOString();
    const pending = db.prepare(`
        SELECT p.id FROM polls p
        WHERE p.status = 'pending' AND p.sent_at IS NULL
        AND datetime(p.deadline) > datetime(?)
    `).all(nowISO);

    for (const poll of pending) {
        try {
            await pollManager.sendPoll(poll.id);
            console.log(`Poll ${poll.id} sent`);
        } catch (err) {
            console.error(`[ERROR] sendPoll ${poll.id}:`, err.message);
        }
    }
}

async function checkDeadlineReminders() {
    const now = new Date();
    const in60min = new Date(now.getTime() + 60 * 60 * 1000);

    const polls = db.prepare(`
        SELECT id, deadline FROM polls
        WHERE status = 'active' AND reminder_sent = 0
        AND datetime(deadline) <= datetime(?) AND datetime(deadline) > datetime(?)
    `).all(in60min.toISOString(), now.toISOString());

    for (const poll of polls) {
        try {
            await pollManager.sendDeadlineReminder(poll.id);
            console.log(`Deadline reminder sent for poll ${poll.id}`);
        } catch (err) {
            console.error(`[ERROR] sendDeadlineReminder ${poll.id}:`, err.message);
        }
    }
}

// Close active polls whose deadline has passed
async function checkAndClosePolls() {
    const result = db.prepare(`
        UPDATE polls SET status = 'closed'
        WHERE status = 'active' AND datetime(deadline) <= datetime('now')
    `).run();
    if (result.changes > 0) {
        console.log(`${result.changes} poll(s) closed (deadline passed)`);
    }
}

// Post group results ONLY for CLOSED polls (not active!)
async function checkGroupPosts() {
    const polls = db.prepare(`
        SELECT p.id, p.event_date, e.event_time, e.group_post_minutes_before
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.status = 'closed' AND p.group_posted = 0 AND p.archived = 0
    `).all();

    const now = new Date();
    for (const poll of polls) {
        const eventUtc = parseBerlinDateTime(poll.event_date, poll.event_time);
        if (isNaN(eventUtc.getTime())) continue;
        const postTime = new Date(eventUtc.getTime() - (poll.group_post_minutes_before || 60) * 60 * 1000);

        if (now >= postTime) {
            try {
                await pollManager.postGroupResults(poll.id);
                console.log(`Group results posted for poll ${poll.id}`);
            } catch (err) {
                console.error(`[ERROR] postGroupResults ${poll.id}:`, err.message);
            }
        }
    }
}

async function checkEventReminders() {
    const now = new Date();

    const polls = db.prepare(`
        SELECT p.id, p.event_date, e.event_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.event_reminder_sent = 0 AND p.archived = 0
        AND p.status IN ('active', 'closed')
    `).all();

    for (const poll of polls) {
        const eventUtc = parseBerlinDateTime(poll.event_date, poll.event_time);
        if (isNaN(eventUtc.getTime())) continue;
        const reminderTime = new Date(eventUtc.getTime() - 60 * 60 * 1000);

        if (now >= reminderTime && now < eventUtc) {
            try {
                await pollManager.sendEventReminders(poll.id);
                console.log(`Event reminder sent for poll ${poll.id}`);
            } catch (err) {
                console.error(`[ERROR] sendEventReminders ${poll.id}:`, err.message);
            }
        }
    }
}

async function generateRecurringPolls() {
    const events = db.prepare(`
        SELECT * FROM events WHERE recurring = 1 AND active = 1
    `).all();

    for (const event of events) {
        const todayStr = berlinDateStr();
        const todayDow = berlinDayOfWeek();
        const daysAhead = (event.recurrence_day - todayDow + 7) % 7 || 7;
        const dateStr = addDays(todayStr, daysAhead);

        const existing = db.prepare(`
            SELECT id FROM polls WHERE event_id = ? AND event_date = ?
        `).get(event.id, dateStr);

        if (!existing) {
            try {
                const pollId = pollManager.createPollForEvent(event.id, dateStr, event.poll_deadline_minutes);
                console.log(`Created recurring poll ${pollId} for ${event.title} on ${dateStr}`);
            } catch (err) {
                console.error(`[ERROR] createPollForEvent recurring ${event.id}:`, err.message);
            }
        }
    }
}

async function archiveOldPolls() {
    const now = new Date();
    const polls = db.prepare(`
        SELECT p.id, p.event_date, e.event_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.archived = 0
    `).all();

    for (const poll of polls) {
        const eventUtc = parseBerlinDateTime(poll.event_date, poll.event_time);
        if (isNaN(eventUtc.getTime())) continue;
        const archiveTime = new Date(eventUtc.getTime() + 24 * 60 * 60 * 1000); // 24h after event
        if (now >= archiveTime) {
            db.prepare('UPDATE polls SET archived = 1 WHERE id = ?').run(poll.id);
            console.log(`Poll ${poll.id} archived`);
        }
    }
}

module.exports = { startScheduler };
