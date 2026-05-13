const cron = require('node-cron');
const db = require('../db/database');
const pollManager = require('./pollManager');
const { parseBerlinDateTime, TZ } = require('./timeUtils');
const { scheduleDescriptionUpdate } = require('./groupDescription');

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
    let isRunning = false;
    let lastParticipantSyncAt = 0;

    cron.schedule('* * * * *', async () => {
        if (isRunning) {
            console.warn('[WARN] Scheduler tick skipped because previous tick is still running');
            return;
        }

        isRunning = true;
        try {
            cleanupExceptedPendingPolls();
            if (Date.now() - lastParticipantSyncAt >= 5 * 60 * 1000) {
                await pollManager.syncGroupParticipants();
                lastParticipantSyncAt = Date.now();
            }
            await checkAndSendPolls();
            await checkDeadlineReminders();
            await checkAndClosePolls();
            await checkGroupPosts();
            await checkEventReminders();
            await generateRecurringPolls();
            await archiveOldPolls();
            await checkDescriptionEventSwitch();
            await pollManager.reconcilePinnedActivePoll();
        } catch (err) {
            console.error('[ERROR] Scheduler:', err);
        } finally {
            isRunning = false;
        }
    });

    console.log('Scheduler started');
}

function cleanupExceptedPendingPolls() {
    const stalePolls = db.prepare(`
        SELECT p.id, p.event_date, p.event_id
        FROM polls p
        WHERE p.status = 'pending' AND p.archived = 0
        AND EXISTS (
            SELECT 1
            FROM event_exceptions ex
            WHERE ex.event_id = p.event_id AND ex.exception_date = p.event_date
        )
    `).all();

    if (stalePolls.length === 0) return 0;

    const remove = db.transaction((polls) => {
        for (const poll of polls) {
            db.prepare('DELETE FROM poll_responses WHERE poll_id = ?').run(poll.id);
            db.prepare('DELETE FROM polls WHERE id = ?').run(poll.id);
        }
    });
    remove(stalePolls);

    console.log(`[INFO] Cleaned up ${stalePolls.length} excepted pending poll(s) before scheduler processing`);
    scheduleDescriptionUpdate();
    return stalePolls.length;
}

async function checkAndSendPolls() {
    const nowISO = new Date().toISOString();
    const pending = db.prepare(`
        SELECT p.id, p.event_id, p.event_date FROM polls p
        WHERE p.status = 'pending' AND p.sent_at IS NULL
        AND datetime(p.deadline) > datetime(?)
        AND (p.send_after IS NULL OR datetime(p.send_after) <= datetime(?))
    `).all(nowISO, nowISO);

    for (const poll of pending) {
        // Skip if date is an exception
        const exception = db.prepare(
            'SELECT id FROM event_exceptions WHERE event_id = ? AND exception_date = ?'
        ).get(poll.event_id, poll.event_date);
        if (exception) {
            db.prepare('DELETE FROM poll_responses WHERE poll_id = ?').run(poll.id);
            db.prepare('DELETE FROM polls WHERE id = ?').run(poll.id);
            console.log(`Poll ${poll.id} deleted (excepted date ${poll.event_date})`);
            continue;
        }
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

    const polls = db.prepare(`
        SELECT p.id, p.deadline, p.reminder_sent, p.reminder_2_sent,
            e.deadline_reminder_1_minutes, e.deadline_reminder_2_minutes
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.status = 'active' AND (p.reminder_sent = 0 OR p.reminder_2_sent = 0)
    `).all();

    for (const poll of polls) {
        const deadline = new Date(poll.deadline);
        if (now >= deadline) continue;

        const r1Min = poll.deadline_reminder_1_minutes ?? 120;
        const r2Min = poll.deadline_reminder_2_minutes ?? 15;
        const r1Time = new Date(deadline.getTime() - r1Min * 60 * 1000);
        const r2Time = new Date(deadline.getTime() - r2Min * 60 * 1000);

        if (!poll.reminder_sent && now >= r1Time) {
            try {
                await pollManager.sendDeadlineReminder(poll.id);
                console.log(`Deadline reminder 1 sent for poll ${poll.id}`);
            } catch (err) {
                console.error(`[ERROR] sendDeadlineReminder 1 ${poll.id}:`, err.message);
            }
        }
        if (!poll.reminder_2_sent && now >= r2Time) {
            try {
                await pollManager.sendDeadlineReminder(poll.id, true);
                console.log(`Deadline reminder 2 sent for poll ${poll.id}`);
            } catch (err) {
                console.error(`[ERROR] sendDeadlineReminder 2 ${poll.id}:`, err.message);
            }
        }
    }
}

// Close active polls whose deadline has passed, check auto-cancel
async function checkAndClosePolls() {
    const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';
    const evolution = require('./evolution');

    const pollsToClose = db.prepare(`
        SELECT p.id, p.event_id, p.event_date, e.title, e.description, e.event_time, e.end_time, e.meeting_time, e.auto_cancel, e.min_participants
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.status = 'active' AND datetime(p.deadline) <= datetime('now')
    `).all();

    for (const poll of pollsToClose) {
        await pollManager.closePoll(poll.id);
        pollManager.ensureNextRecurringPoll(poll.event_id, poll.event_date);
        console.log(`Poll ${poll.id} closed (deadline passed)`);

        // Check auto-cancel
        if (poll.auto_cancel && poll.min_participants > 0 && GROUP_CHAT_ID) {
            const yesCount = db.prepare(
                "SELECT COUNT(*) as cnt FROM poll_responses WHERE poll_id = ? AND response = 'yes'"
            ).get(poll.id).cnt;
            if (yesCount < poll.min_participants) {
                try {
                    await evolution.sendCancellationMessage(
                        GROUP_CHAT_ID, poll.title, poll.event_date,
                        poll.event_time, poll.end_time, yesCount, poll.min_participants, poll.meeting_time, poll.description
                    );
                    console.log(`[INFO] Auto-cancel sent for poll ${poll.id} (${yesCount}/${poll.min_participants})`);
                } catch (err) {
                    console.error(`[ERROR] sendCancellationMessage ${poll.id}:`, err.message);
                }
            }
        }
    }
    if (pollsToClose.length > 0) {
        scheduleDescriptionUpdate();
    }
}

// Post group results immediately for closed polls
async function checkGroupPosts() {
    const polls = db.prepare(`
        SELECT p.id, e.auto_cancel, e.min_participants
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.status = 'closed' AND p.group_posted = 0 AND p.archived = 0
    `).all();

    for (const poll of polls) {
        try {
            let cancelInfo = null;
            if (poll.auto_cancel && poll.min_participants > 0) {
                const yesCount = db.prepare(
                    "SELECT COUNT(*) as cnt FROM poll_responses WHERE poll_id = ? AND response = 'yes'"
                ).get(poll.id).cnt;
                if (yesCount < poll.min_participants) {
                    cancelInfo = { yesCount, min: poll.min_participants };
                }
            }
            await pollManager.postGroupResults(poll.id, cancelInfo);
            console.log(`Group results posted for poll ${poll.id}`);
        } catch (err) {
            console.error(`[ERROR] postGroupResults ${poll.id}:`, err.message);
        }
    }
}

async function checkEventReminders() {
    const now = new Date();

    const polls = db.prepare(`
        SELECT p.id, p.event_date, e.event_time, e.event_reminder_minutes
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.event_reminder_sent = 0 AND p.archived = 0
        AND p.status IN ('active', 'closed')
    `).all();

    for (const poll of polls) {
        const eventUtc = parseBerlinDateTime(poll.event_date, poll.event_time);
        if (isNaN(eventUtc.getTime())) continue;
        const minutes = poll.event_reminder_minutes ?? 60;
        const reminderTime = new Date(eventUtc.getTime() - minutes * 60 * 1000);

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
        const now = new Date();

        // Generate polls for today (if same weekday and event not passed) AND next occurrence
        const daysToday = (event.recurrence_day - todayDow + 7) % 7;
        const candidates = daysToday === 0
            ? [addDays(todayStr, 0), addDays(todayStr, 7)]  // today + next week
            : [addDays(todayStr, daysToday)];                // next occurrence only

        for (const dateStr of candidates) {
            // Skip if event time already passed
            const eventUtc = parseBerlinDateTime(dateStr, event.event_time);
            if (!isNaN(eventUtc.getTime()) && now >= eventUtc) continue;

            // Skip if date is an exception
            const exception = db.prepare(
                'SELECT id FROM event_exceptions WHERE event_id = ? AND exception_date = ?'
            ).get(event.id, dateStr);
            if (exception) continue;

            const existing = db.prepare(`
                SELECT id FROM polls WHERE event_id = ? AND event_date = ?
            `).get(event.id, dateStr);

            if (!existing) {
                try {
                    const pollId = pollManager.createPollForEvent(event.id, dateStr, event.poll_deadline_minutes, event.poll_send_minutes_before);
                    console.log(`Created recurring poll ${pollId} for ${event.title} on ${dateStr}`);
                } catch (err) {
                    console.error(`[ERROR] createPollForEvent recurring ${event.id}:`, err.message);
                }
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
            scheduleDescriptionUpdate();
        }
    }
}

// Update group description when an event starts or ends (so it switches to the next event)
let lastDescriptionPollId = null;
async function checkDescriptionEventSwitch() {
    const now = new Date();
    // Find the first non-archived poll whose event hasn't ended yet
    const polls = db.prepare(`
        SELECT p.id, p.event_date, e.event_time, e.end_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.archived = 0 AND p.status IN ('pending', 'active', 'closed')
        ORDER BY p.event_date ASC, e.event_time ASC
    `).all();

    let currentPollId = null;
    for (const p of polls) {
        const relevantTime = p.end_time || p.event_time;
        const eventEnd = parseBerlinDateTime(p.event_date, relevantTime);
        if (isNaN(eventEnd.getTime()) || now < eventEnd) {
            currentPollId = p.id;
            break;
        }
    }

    // If the "current" poll changed, trigger a description update
    if (lastDescriptionPollId !== null && currentPollId !== lastDescriptionPollId) {
        console.log(`[INFO] Description event switch: poll ${lastDescriptionPollId} → ${currentPollId}`);
        scheduleDescriptionUpdate();
    }
    lastDescriptionPollId = currentPollId;
}

module.exports = { startScheduler };
