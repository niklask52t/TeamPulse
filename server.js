require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const crypto = require('crypto');

const authRouter = require('./routes/auth');
const contactsRouter = require('./routes/contacts');
const eventsRouter = require('./routes/events');
const pollsRouter = require('./routes/polls');
const statsRouter = require('./routes/stats');
const { startScheduler } = require('./services/scheduler');
const { getGroups } = require('./services/waha');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Log unhandled errors so they appear in journalctl
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
    process.exit(1);
});
process.on('unhandledRejection', (err) => {
    console.error('[ERROR] Unhandled Rejection:', err);
});

app.use(express.json());

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24h
    },
}));

// Auth middleware
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Nicht angemeldet' });
    }
    next();
}

// Public routes
app.use('/api/auth', authRouter);

// WAHA webhook (machine-to-machine, kein Login nötig)
app.post('/api/webhooks/waha', (req, res, next) => {
    req.body = req.body || {};
    req.body.event = req.body.event || 'message';
    req.body.payload = req.body.payload || req.body;
    // Forward directly to the webhook handler in pollsRouter
    req.url = '/webhook';
    next();
}, pollsRouter);

// Alle anderen API-Routen benötigen Login
app.use('/api', requireAuth);
// WhatsApp groups from WAHA
app.get('/api/groups', async (req, res, next) => {
    try {
        const groups = await getGroups();
        res.json(groups);
    } catch (err) {
        next(err);
    }
});

app.use('/api/contacts', contactsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/polls', pollsRouter);
app.use('/api/stats', statsRouter);

// Statische Dateien
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*splat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Express error handler — logs to journalctl
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${req.method} ${req.url}:`, err.stack || err.message || err);
    res.status(err.status || 500).json({ error: err.message || 'Interner Serverfehler' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`TeamPulse running on http://0.0.0.0:${PORT}`);
    startScheduler();
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[FATAL] Port ${PORT} ist bereits belegt! Läuft WAHA auf dem gleichen Port?`);
    } else {
        console.error('[FATAL] Server error:', err);
    }
    process.exit(1);
});
