require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const SQLiteSessionStore = require('./services/sessionStore');

const authRouter = require('./routes/auth');
const contactsRouter = require('./routes/contacts');
const eventsRouter = require('./routes/events');
const pollsRouter = require('./routes/polls');
const statsRouter = require('./routes/stats');
const settingsRouter = require('./routes/settings');
const descBlocksRouter = require('./routes/descriptionBlocks');
const dashboardRouter = require('./routes/dashboard');
const { startScheduler } = require('./services/scheduler');
const { getGroups } = require('./services/evolution');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const isProduction = process.env.NODE_ENV === 'production';
const sessionStore = new SQLiteSessionStore({
    ttlMs: 24 * 60 * 60 * 1000,
    cleanupEveryMs: 15 * 60 * 1000,
});
const pageLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
});
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1200,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
});
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
    process.exit(1);
});
process.on('unhandledRejection', (err) => {
    console.error('[ERROR] Unhandled Rejection:', err);
});

app.use(express.json());
app.set('trust proxy', 1);

app.use(session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000,
        secure: isProduction,
    },
}));

function getOrCreateCsrfToken(req) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
}

app.use((req, res, next) => {
    req.csrfToken = () => getOrCreateCsrfToken(req);
    next();
});

function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Nicht angemeldet' });
    }
    next();
}

app.use('/api/auth', authLimiter);

app.post(['/api/webhooks/evolution', '/api/webhooks/evolution/messages-upsert'], (req, res, next) => {
    req.body = req.body || {};
    req.body.event = req.body.event || 'MESSAGES_UPSERT';
    req.url = '/webhook/evolution';
    next();
}, pollsRouter);

app.use((req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return next();
    }
    const incomingToken = req.get('x-csrf-token') || req.body?._csrf || '';
    const sessionToken = getOrCreateCsrfToken(req);
    if (!incomingToken || incomingToken !== sessionToken) {
        return res.status(403).json({ error: 'Ungueltiger oder fehlender CSRF-Token' });
    }
    next();
});

app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.use('/api', apiLimiter);

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
app.use('/api/settings', settingsRouter);
app.use('/api/description-blocks', descBlocksRouter);
app.use('/api/dashboard', dashboardRouter);

app.use('/vendor/flatpickr', pageLimiter, express.static(path.join(__dirname, 'node_modules', 'flatpickr', 'dist')));
app.use(pageLimiter, express.static(path.join(__dirname, 'public')));

app.get('*splat', pageLimiter, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
    console.error('[ERROR] %s %s:', req.method, req.url, err.stack || err.message || err);
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
