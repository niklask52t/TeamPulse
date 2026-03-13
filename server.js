require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const crypto = require('crypto');

const authRouter = require('./routes/auth');
const contactsRouter = require('./routes/contacts');
const eventsRouter = require('./routes/events');
const pollsRouter = require('./routes/polls');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

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

// Auth middleware – alle API-Routen außer /api/auth und WAHA-Webhook
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
    next();
}, pollsRouter);

// Alle anderen API-Routen benötigen Login
app.use('/api', requireAuth);
app.use('/api/contacts', contactsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/polls', pollsRouter);

// Statische Dateien (Login-HTML muss erreichbar sein)
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*splat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`TeamPulse running on http://localhost:${PORT}`);
    startScheduler();
});
