require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const contactsRouter = require('./routes/contacts');
const eventsRouter = require('./routes/events');
const pollsRouter = require('./routes/polls');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/contacts', contactsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/polls', pollsRouter);

// Webhook for WAHA
app.use('/api/webhooks/waha', (req, res, next) => {
    req.body = req.body || {};
    req.body.event = req.body.event || 'message';
    req.body.payload = req.body.payload || req.body;
    next();
}, pollsRouter);

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`TeamPulse running on http://localhost:${PORT}`);
    startScheduler();
});
