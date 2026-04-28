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
const descBlocksRouter = require('./routes/descriptionBlocks');
const dashboardRouter = require('./routes/dashboard');
const { startScheduler } = require('./services/scheduler');
const { getGroups } = require('./services/evolution');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

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
        maxAge: 24 * 60 * 60 * 1000,
    },
}));

function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Nicht angemeldet' });
    }
    next();
}

app.use('/api/auth', authRouter);

app.post(['/api/webhooks/evolution', '/api/webhooks/evolution/messages-upsert'], (req, res, next) => {
    req.body = req.body || {};
    req.body.event = req.body.event || 'MESSAGES_UPSERT';
    req.url = '/webhook/evolution';
    next();
}, pollsRouter);

app.use('/api', requireAuth);

app.get('/api/config', (req, res) => {
    res.json({ devMode: process.env.DEV_MODE === 'true' });
});

app.get('/api/groups', async (req, res, next) => {
    try {
        const groups = await getGroups();
        const normalized = groups.map((g) => ({
            id: typeof g.id === 'object' ? (g.id._serialized || `${g.id.user}@${g.id.server}` || JSON.stringify(g.id)) : (g.id || ''),
            name: g.subject || g.name || g.title || '',
        }));
        res.json(normalized);
    } catch (err) {
        next(err);
    }
});

app.use('/api/contacts', contactsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/polls', pollsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/description-blocks', descBlocksRouter);
app.use('/api/dashboard', dashboardRouter);

app.use(express.static(path.join(__dirname, 'public')));

app.get('*splat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
        console.error(`[FATAL] Port ${PORT} ist bereits belegt! Laeuft Evolution API oder ein anderer Dienst auf dem gleichen Port?`);
    } else {
        console.error('[FATAL] Server error:', err);
    }
    process.exit(1);
});
