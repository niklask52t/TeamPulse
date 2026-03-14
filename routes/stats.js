const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET participation stats per contact (only counts closed/archived polls)
router.get('/', (req, res) => {
    const stats = db.prepare(`
        SELECT
            c.id,
            c.name,
            c.phone,
            COUNT(pr.id) as total_polls,
            SUM(CASE WHEN pr.response = 'yes'   THEN 1 ELSE 0 END) as yes_count,
            SUM(CASE WHEN pr.response = 'no'    THEN 1 ELSE 0 END) as no_count,
            SUM(CASE WHEN pr.response = 'maybe' THEN 1 ELSE 0 END) as maybe_count,
            SUM(CASE WHEN pr.response IS NULL   THEN 1 ELSE 0 END) as no_response_count
        FROM contacts c
        LEFT JOIN poll_responses pr ON c.id = pr.contact_id
        LEFT JOIN polls p ON pr.poll_id = p.id AND p.status = 'closed'
        GROUP BY c.id
        ORDER BY c.name
    `).all();

    const result = stats.map(s => ({
        ...s,
        responded: s.yes_count + s.no_count + s.maybe_count,
        response_rate: s.total_polls > 0
            ? Math.round((s.yes_count + s.no_count + s.maybe_count) / s.total_polls * 100)
            : 0,
    }));

    res.json(result);
});

module.exports = router;
