const db = require('../db/database');
const waha = require('./waha');

const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';

function createPollForEvent(eventId, eventDate, deadlineMinutes) {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) throw new Error(`Event ${eventId} not found`);

    const eventDateTime = new Date(`${eventDate}T${event.event_time}`);
    const deadline = new Date(eventDateTime.getTime() - deadlineMinutes * 60 * 1000);

    const result = db.prepare(`
        INSERT INTO polls (event_id, event_date, deadline, status)
        VALUES (?, ?, ?, 'pending')
    `).run(eventId, eventDate, deadline.toISOString());

    const pollId = result.lastInsertRowid;

    const contacts = db.prepare('SELECT * FROM contacts').all();
    const insertResponse = db.prepare(`
        INSERT INTO poll_responses (poll_id, contact_id) VALUES (?, ?)
    `);
    for (const contact of contacts) {
        insertResponse.run(pollId, contact.id);
    }

    return pollId;
}

async function sendPoll(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.event_time, e.type
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) throw new Error(`Poll ${pollId} not found`);

    const responses = db.prepare(`
        SELECT pr.*, c.phone, c.name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ? AND pr.message_sent = 0
    `).all(pollId);

    for (const r of responses) {
        try {
            const chatId = r.phone.replace('+', '') + '@c.us';
            await waha.sendPollMessage(chatId, poll.title, poll.event_date, poll.event_time);
            db.prepare('UPDATE poll_responses SET message_sent = 1 WHERE id = ?').run(r.id);
        } catch (err) {
            console.error(`Failed to send poll to ${r.name} (${r.phone}):`, err.message);
        }
    }

    db.prepare("UPDATE polls SET status = 'active', sent_at = datetime('now') WHERE id = ?").run(pollId);
}

function processResponse(phone, text) {
    const normalizedPhone = phone.replace('@c.us', '').replace(/^\+/, '');
    const contact = db.prepare(`
        SELECT * FROM contacts WHERE REPLACE(REPLACE(phone, '+', ''), ' ', '') = ?
    `).get(normalizedPhone.replace(/\s/g, ''));

    if (!contact) return null;

    const activePoll = db.prepare(`
        SELECT pr.id as response_id, p.id as poll_id
        FROM poll_responses pr
        JOIN polls p ON pr.poll_id = p.id
        WHERE pr.contact_id = ? AND p.status = 'active' AND pr.response IS NULL
        ORDER BY p.deadline ASC LIMIT 1
    `).get(contact.id);

    if (!activePoll) return null;

    const lower = text.toLowerCase().trim();
    let response = null;
    if (['ja', 'yes', '👍', '1', 'j', 'klar', 'bin dabei', 'dabei'].some(k => lower.includes(k))) {
        response = 'yes';
    } else if (['nein', 'no', '👎', '2', 'n', 'kann nicht', 'ne'].some(k => lower.includes(k))) {
        response = 'no';
    } else if (['vielleicht', 'maybe', '🤷', '3', 'vllt', 'mal sehen', 'evtl'].some(k => lower.includes(k))) {
        response = 'maybe';
    }

    if (!response) return null;

    db.prepare(`
        UPDATE poll_responses SET response = ?, responded_at = datetime('now') WHERE id = ?
    `).run(response, activePoll.response_id);

    return { contactName: contact.name, response, pollId: activePoll.poll_id };
}

async function sendDeadlineReminder(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.event_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) return;

    const pending = db.prepare(`
        SELECT pr.*, c.phone, c.name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ? AND pr.response IS NULL
    `).all(pollId);

    for (const r of pending) {
        try {
            const chatId = r.phone.replace('+', '') + '@c.us';
            await waha.sendReminder(chatId, poll.title, poll.event_date, poll.event_time, 60);
        } catch (err) {
            console.error(`Failed to send reminder to ${r.name}:`, err.message);
        }
    }

    db.prepare('UPDATE polls SET reminder_sent = 1 WHERE id = ?').run(pollId);
}

async function postGroupResults(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.event_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) return;

    const responses = db.prepare(`
        SELECT pr.response, c.name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ?
    `).all(pollId);

    const yes = responses.filter(r => r.response === 'yes').map(r => r.name);
    const no = responses.filter(r => r.response === 'no').map(r => r.name);
    const maybe = responses.filter(r => r.response === 'maybe').map(r => r.name);

    await waha.postResultsToGroup(GROUP_CHAT_ID, poll.title, poll.event_date, poll.event_time, yes, no, maybe);
    db.prepare("UPDATE polls SET group_posted = 1, status = 'closed' WHERE id = ?").run(pollId);
}

async function sendEventReminders(pollId) {
    const poll = db.prepare(`
        SELECT p.*, e.title, e.event_time
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
    `).get(pollId);
    if (!poll) return;

    const yesResponses = db.prepare(`
        SELECT c.phone, c.name
        FROM poll_responses pr JOIN contacts c ON pr.contact_id = c.id
        WHERE pr.poll_id = ? AND pr.response = 'yes'
    `).all(pollId);

    for (const r of yesResponses) {
        try {
            const chatId = r.phone.replace('+', '') + '@c.us';
            await waha.sendEventReminder(chatId, poll.title, poll.event_time);
        } catch (err) {
            console.error(`Failed to send event reminder to ${r.name}:`, err.message);
        }
    }

    db.prepare('UPDATE polls SET event_reminder_sent = 1 WHERE id = ?').run(pollId);
}

module.exports = {
    createPollForEvent,
    sendPoll,
    processResponse,
    sendDeadlineReminder,
    postGroupResults,
    sendEventReminders,
};
