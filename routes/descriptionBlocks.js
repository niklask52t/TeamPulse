const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { buildDescription, updateGroupDescription } = require('../services/groupDescription');

// GET all blocks
router.get('/', (req, res) => {
    const blocks = db.prepare(
        'SELECT * FROM group_description_blocks ORDER BY position, sort_order ASC, id ASC'
    ).all();
    res.json(blocks);
});

// POST create block
router.post('/', (req, res) => {
    const { content, position, sort_order } = req.body;
    if (!content || !position) {
        return res.status(400).json({ error: 'Inhalt und Position sind erforderlich' });
    }
    if (!['above', 'below'].includes(position)) {
        return res.status(400).json({ error: 'Position muss "above" oder "below" sein' });
    }
    const result = db.prepare(
        'INSERT INTO group_description_blocks (content, position, sort_order) VALUES (?, ?, ?)'
    ).run(content, position, sort_order || 0);
    const block = db.prepare('SELECT * FROM group_description_blocks WHERE id = ?').get(result.lastInsertRowid);
    updateGroupDescription().catch(err => console.error('[ERROR] desc update:', err.message));
    res.status(201).json(block);
});

// PUT update block
router.put('/:id', (req, res) => {
    const { content, position, sort_order } = req.body;
    if (!content || !position) {
        return res.status(400).json({ error: 'Inhalt und Position sind erforderlich' });
    }
    const result = db.prepare(
        'UPDATE group_description_blocks SET content = ?, position = ?, sort_order = ? WHERE id = ?'
    ).run(content, position, sort_order || 0, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Block nicht gefunden' });
    const block = db.prepare('SELECT * FROM group_description_blocks WHERE id = ?').get(req.params.id);
    updateGroupDescription().catch(err => console.error('[ERROR] desc update:', err.message));
    res.json(block);
});

// DELETE block
router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM group_description_blocks WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Block nicht gefunden' });
    updateGroupDescription().catch(err => console.error('[ERROR] desc update:', err.message));
    res.json({ success: true });
});

// GET preview
router.get('/preview', (req, res) => {
    const description = buildDescription();
    res.json({ description, length: description.length, maxLength: 2048 });
});

// POST manual update trigger
router.post('/update', async (req, res) => {
    try {
        await updateGroupDescription();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
