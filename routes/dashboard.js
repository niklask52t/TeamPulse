const express = require('express');
const router = express.Router();
const db = require('../db/database');

router.get('/', (req, res) => {
    // Next upcoming event
    const nextEvent = db.prepare(`
        SELECT p.id as poll_id, p.event_date, p.deadline, p.status, e.title, e.event_time, e.end_time, e.meeting_time, e.type, e.auto_cancel, e.min_participants
        FROM polls p JOIN events e ON p.event_id = e.id
        WHERE p.archived = 0 AND p.status IN ('pending', 'active')
        ORDER BY p.event_date ASC, e.event_time ASC LIMIT 1
    `).get() || null;

    // Active polls with response counts
    const activePolls = db.prepare(`
        SELECT p.id, p.event_date, p.deadline, p.status, e.title, e.event_time, e.auto_cancel, e.min_participants,
            SUM(CASE WHEN pr.response = 'yes' THEN 1 ELSE 0 END) as yes_count,
            SUM(CASE WHEN pr.response = 'no' THEN 1 ELSE 0 END) as no_count,
            SUM(CASE WHEN pr.response = 'maybe' THEN 1 ELSE 0 END) as maybe_count,
            SUM(CASE WHEN pr.response IS NULL THEN 1 ELSE 0 END) as pending_count,
            COUNT(pr.id) as total
        FROM polls p JOIN events e ON p.event_id = e.id
        LEFT JOIN poll_responses pr ON p.id = pr.poll_id
        WHERE p.status = 'active' AND p.archived = 0
        GROUP BY p.id
        ORDER BY p.event_date ASC
    `).all();

    // Quick stats
    const totalEvents = db.prepare('SELECT COUNT(*) as cnt FROM events WHERE active = 1').get().cnt;
    const totalMembers = db.prepare('SELECT COUNT(*) as cnt FROM contacts').get().cnt;
    const totalClosedPolls = db.prepare("SELECT COUNT(*) as cnt FROM polls WHERE status = 'closed'").get().cnt;

    const avgRow = db.prepare(`
        SELECT
            CASE WHEN COUNT(pr.id) > 0
                THEN ROUND(100.0 * SUM(CASE WHEN pr.response IS NOT NULL THEN 1 ELSE 0 END) / COUNT(pr.id))
                ELSE 0 END as avg_rate
        FROM poll_responses pr
        JOIN polls p ON pr.poll_id = p.id
        WHERE p.status = 'closed'
    `).get();
    const avgAttendanceRate = avgRow?.avg_rate || 0;

    // Trend: last 10 closed polls
    const responseTrend = db.prepare(`
        SELECT p.id, p.event_date, e.title,
            SUM(CASE WHEN pr.response = 'yes' THEN 1 ELSE 0 END) as yes_count,
            SUM(CASE WHEN pr.response IS NOT NULL THEN 1 ELSE 0 END) as responded,
            COUNT(pr.id) as total
        FROM polls p JOIN events e ON p.event_id = e.id
        LEFT JOIN poll_responses pr ON p.id = pr.poll_id
        WHERE p.status = 'closed'
        GROUP BY p.id
        ORDER BY p.event_date DESC LIMIT 10
    `).all().reverse();

    res.json({
        nextEvent,
        activePolls,
        quickStats: { totalEvents, totalMembers, avgAttendanceRate, totalClosedPolls },
        responseTrend,
    });
});

module.exports = router;
