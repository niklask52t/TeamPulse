const cron = require('node-cron');
const db = require('../db/database');
const pollManager = require('./pollManager');

function startScheduler() {
    // Run every minute to check for pending actions
    cron.schedule('* * * * *', async () => {
        try {
            await checkAndSendPolls();
            await checkDeadlineReminders();
            await checkGroupPosts();
            await checkEventReminders();
            await generateRecurringPolls();
        } catch (err) {
            console.error('Scheduler error:', err);
        }
    });

    console.log('Scheduler started');
}

async function checkAndSendPolls() {
    const pending = db.prepare(`
        SELECT p.id FROM polls p
        WHERE p.status = 'pending' AND p.sent_at IS NULL
        AND datetime(p.deadline) > datetime('now')
    `).all();

    for (const poll of pending) {
        await pollManager.sendPoll(poll.id);
        console.log(`Poll ${poll.id} sent`);
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
        await pollManager.sendDeadlineReminder(poll.id);
        console.log(`Deadline reminder sent for poll ${poll.id}`);
    }
}

async function checkGroupPosts() {
    const polls = db.prepare(`
        SELECT p.id, p.event_date, e.event_time, e.group_post_minutes_before
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.status = 'active' AND p.group_posted = 0
        AND datetime(p.deadline) <= datetime('now')
    `).all();

    for (const poll of polls) {
        const eventDateTime = new Date(`${poll.event_date}T${poll.event_time}`);
        const postTime = new Date(eventDateTime.getTime() - (poll.group_post_minutes_before || 60) * 60 * 1000);

        if (new Date() >= postTime) {
            await pollManager.postGroupResults(poll.id);
            console.log(`Group results posted for poll ${poll.id}`);
        }
    }
}

async function checkEventReminders() {
    const now = new Date();
    const in60min = new Date(now.getTime() + 60 * 60 * 1000);

    const polls = db.prepare(`
        SELECT p.id, p.event_date, e.event_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.event_reminder_sent = 0
        AND p.status IN ('active', 'closed')
    `).all();

    for (const poll of polls) {
        const eventDateTime = new Date(`${poll.event_date}T${poll.event_time}`);
        const reminderTime = new Date(eventDateTime.getTime() - 60 * 60 * 1000);

        if (now >= reminderTime && now < eventDateTime) {
            await pollManager.sendEventReminders(poll.id);
            console.log(`Event reminder sent for poll ${poll.id}`);
        }
    }
}

async function generateRecurringPolls() {
    const events = db.prepare(`
        SELECT * FROM events WHERE recurring = 1 AND active = 1
    `).all();

    const dayMap = [
        'Sonntag', 'Montag', 'Dienstag', 'Mittwoch',
        'Donnerstag', 'Freitag', 'Samstag'
    ];

    for (const event of events) {
        // Find next occurrence of recurrence_day
        const now = new Date();
        const daysAhead = (event.recurrence_day - now.getDay() + 7) % 7 || 7;
        const nextDate = new Date(now);
        nextDate.setDate(now.getDate() + daysAhead);
        const dateStr = nextDate.toISOString().split('T')[0];

        const existing = db.prepare(`
            SELECT id FROM polls WHERE event_id = ? AND event_date = ?
        `).get(event.id, dateStr);

        if (!existing) {
            const pollId = pollManager.createPollForEvent(event.id, dateStr, event.poll_deadline_minutes);
            console.log(`Created recurring poll ${pollId} for ${event.title} on ${dateStr}`);
        }
    }
}

module.exports = { startScheduler };
