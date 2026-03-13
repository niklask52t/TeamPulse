const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET all contacts
router.get('/', (req, res) => {
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY name').all();
    res.json(contacts);
});

// POST create contact
router.post('/', (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) {
        return res.status(400).json({ error: 'Name und Telefonnummer sind erforderlich' });
    }
    try {
        const result = db.prepare('INSERT INTO contacts (name, phone) VALUES (?, ?)').run(name, phone);
        res.status(201).json({ id: result.lastInsertRowid, name, phone });
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Telefonnummer existiert bereits' });
        }
        throw err;
    }
});

// PUT update contact
router.put('/:id', (req, res) => {
    const { name, phone } = req.body;
    const result = db.prepare('UPDATE contacts SET name = ?, phone = ? WHERE id = ?')
        .run(name, phone, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Kontakt nicht gefunden' });
    res.json({ id: Number(req.params.id), name, phone });
});

// DELETE contact
router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Kontakt nicht gefunden' });
    res.json({ success: true });
});

module.exports = router;
