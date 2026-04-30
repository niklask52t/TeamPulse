const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { syncGroupParticipants } = require('../services/pollManager');

// GET all contacts
router.get('/', async (req, res) => {
    try {
        await syncGroupParticipants();
    } catch (err) {
        console.error('[WARN] contact sync before GET /contacts failed:', err.message);
    }
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

// PUT set LID mapping for a contact
router.put('/:id/lid', (req, res) => {
    const { lid } = req.body;
    if (!lid) return res.status(400).json({ error: 'LID erforderlich' });
    const lidDigits = String(lid).replace(/@lid/g, '').replace(/\D/g, '');
    const result = db.prepare('UPDATE contacts SET lid = ? WHERE id = ?').run(lidDigits, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Kontakt nicht gefunden' });
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    res.json(contact);
});

// DELETE contact
router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Kontakt nicht gefunden' });
    res.json({ success: true });
});

module.exports = router;
