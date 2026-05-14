// ===== CORE CONFIG =====
const API = '';
const TZ = 'Europe/Berlin';
let headerClockTimer = null;
let csrfToken = '';

// ===== DATE / TIME HELPERS =====

function startClock() {
    if (headerClockTimer) return;
    function tick() {
        document.getElementById('header-clock').textContent = new Date().toLocaleString('de-DE', {
            timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit',
            year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    }
    tick();
    headerClockTimer = setInterval(tick, 1000);
}

// Format minutes as human-readable hours (e.g. 90 → "1.5h", 30 → "30 Min")
function fmtHours(minutes) {
    if (!minutes) return '—';
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    if (minutes < 60) return `${minutes} Min`;
    return `${(minutes / 60).toFixed(1).replace('.0', '')}h`;
}

function parseServerDateTime(value) {
    if (!value) return new Date(NaN);
    if (value instanceof Date) return value;
    const text = String(value).trim();
    if (!text) return new Date(NaN);

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
        return new Date(text.replace(' ', 'T') + 'Z');
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) {
        return new Date(text + 'Z');
    }
    return new Date(text);
}

function fmtDeadline(isoStr) {
    return parseServerDateTime(isoStr).toLocaleString('de-DE', { timeZone: TZ });
}

function todayStr() {
    return new Date().toLocaleString('sv-SE', { timeZone: TZ }).split(' ')[0];
}

function fmtDateFancy(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00Z');
    const day = d.getUTCDate();
    const month = d.toLocaleString('de-DE', { month: 'short', timeZone: 'UTC' });
    const weekday = d.toLocaleString('de-DE', { weekday: 'short', timeZone: 'UTC' });
    return `<span class="date-card"><span class="date-card-day">${day}</span><span class="date-card-month">${weekday}, ${month}</span></span>`;
}

// ===== FORM DIRTY TRACKING =====

let formDirty = false;

function markDirty() { formDirty = true; }
function clearDirty() { formDirty = false; }

function checkDirtyAndClose() {
    if (!formDirty) return true;
    if (confirm('Du hast ungespeicherte Änderungen. Verwerfen?')) {
        clearDirty();
        return true;
    }
    return false;
}

// ===== AUTH =====

async function checkAuth() {
    try {
        await refreshCsrfToken();
        const res = await fetch(`${API}/api/auth/me`);
        if (!res.ok) { showLogin(); return; }
        const data = await res.json();
        if (data.mustChangePassword) {
            showChangePassword(data.username);
        } else {
            showApp(data.username);
        }
    } catch {
        showLogin();
    }
}

async function refreshCsrfToken() {
    const res = await fetch(`${API}/api/auth/csrf`);
    if (!res.ok) {
        throw new Error(`CSRF ${res.status}`);
    }
    const data = await res.json();
    csrfToken = data.csrfToken || '';
}

function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('change-pw-screen').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-error').classList.add('hidden');
}

function showChangePassword(username) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('change-pw-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('change-username').placeholder = `Aktuell: ${username} (leer lassen um beizubehalten)`;
}

function showApp(username) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('change-pw-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('current-user').textContent = username;
    startClock();
    renderChangelog();
    const savedTab = localStorage.getItem('activeTab') || 'dashboard';
    activateTab(savedTab);
}

async function doLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl  = document.getElementById('login-error');

    if (!csrfToken) await refreshCsrfToken();
    const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
        const data = await res.json();
        errorEl.textContent = data.error || 'Login fehlgeschlagen';
        errorEl.classList.remove('hidden');
        return;
    }
    const data = await res.json();
    if (data.mustChangePassword) {
        showChangePassword(data.username);
    } else {
        showApp(data.username);
    }
}

async function doChangePassword(e) {
    e.preventDefault();
    const newPassword = document.getElementById('change-password').value;
    const confirmPw   = document.getElementById('change-password-confirm').value;
    const newUsername = document.getElementById('change-username').value;
    const errorEl     = document.getElementById('change-error');

    if (newPassword !== confirmPw) {
        errorEl.textContent = 'Passwörter stimmen nicht überein';
        errorEl.classList.remove('hidden');
        return;
    }

    if (!csrfToken) await refreshCsrfToken();
    const res = await fetch(`${API}/api/auth/change-password`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ newPassword, newUsername: newUsername || undefined }),
    });

    if (!res.ok) {
        const data = await res.json();
        errorEl.textContent = data.error || 'Fehler beim Ändern';
        errorEl.classList.remove('hidden');
        return;
    }
    const data = await res.json();
    showApp(data.username);
}

async function doLogout() {
    if (!csrfToken) await refreshCsrfToken();
    await fetch(`${API}/api/auth/logout`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
    });
    showLogin();
}

async function apiFetch(url, options) {
    const init = { ...(options || {}) };
    const method = (init.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        if (!csrfToken) await refreshCsrfToken();
        init.headers = {
            ...(init.headers || {}),
            'x-csrf-token': csrfToken,
        };
    }

    let res = await fetch(url, init);
    if (res.status === 403 && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        await refreshCsrfToken();
        init.headers = {
            ...(init.headers || {}),
            'x-csrf-token': csrfToken,
        };
        res = await fetch(url, init);
    }
    if (res.status === 401) {
        showLogin();
        throw new Error('Nicht angemeldet');
    }
    return res;
}

// ===== NAVIGATION =====

async function activateTab(tabId) {
    if (['wiki', 'changelog'].includes(tabId)) tabId = 'dashboard';
    if (!checkDirtyAndClose()) return;
    hideAllForms();
    // Reload tab data on every switch to avoid stale/empty content
    if (tabId === 'dashboard') await loadDashboard();
    if (tabId === 'events') await loadEvents();
    if (tabId === 'polls') await loadPolls();
    if (tabId === 'stats') await loadStats();
    if (tabId === 'contacts' && typeof loadContacts === 'function') await loadContacts();
    if (tabId === 'settings' && typeof loadSettings === 'function') await loadSettings();
    if (tabId === 'description' && typeof loadDescriptionBlocks === 'function') await loadDescriptionBlocks();

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');
    const tab = document.getElementById(tabId);
    if (tab) tab.classList.add('active');
    localStorage.setItem('activeTab', tabId);
}

function hideAllForms() {
    hideEventForm();
    if (typeof hideDescBlockForm === 'function') hideDescBlockForm();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// ===== OVERLAYS =====

function openOverlay(name) {
    const overlay = document.getElementById(`overlay-${name}`);
    if (!overlay) return;
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeOverlay(name) {
    const overlay = document.getElementById(`overlay-${name}`);
    if (!overlay) return;
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
}

function showConfirmDialog(message, options = {}) {
    const overlay = document.getElementById('confirm-dialog');
    const titleEl = document.getElementById('confirm-dialog-title');
    const messageEl = document.getElementById('confirm-dialog-message');
    const cancelBtn = document.getElementById('confirm-dialog-cancel');
    const confirmBtn = document.getElementById('confirm-dialog-confirm');
    if (!overlay || !titleEl || !messageEl || !cancelBtn || !confirmBtn) {
        return Promise.resolve(confirm(message));
    }

    const title = options.title || 'Bestätigung';
    const confirmText = options.confirmText || 'Ja';
    const cancelText = options.cancelText || 'Nein';

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    return new Promise((resolve) => {
        const cleanup = (result) => {
            overlay.classList.add('hidden');
            document.body.style.overflow = '';
            cancelBtn.removeEventListener('click', onCancel);
            confirmBtn.removeEventListener('click', onConfirm);
            document.removeEventListener('keydown', onKeydown);
            resolve(result);
        };

        const onCancel = () => cleanup(false);
        const onConfirm = () => cleanup(true);
        const onKeydown = (event) => {
            if (event.key === 'Escape') cleanup(false);
        };

        cancelBtn.addEventListener('click', onCancel);
        confirmBtn.addEventListener('click', onConfirm);
        document.addEventListener('keydown', onKeydown);
        confirmBtn.focus();
    });
}

// Close overlay on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.overlay:not(.hidden)').forEach(el => {
            const name = el.id.replace('overlay-', '');
            closeOverlay(name);
        });
    }
});

// ===== FOOTER =====

function toggleFooterSection(section) {
    const panel = document.getElementById(`footer-${section}`);
    const chevron = document.getElementById(`${section}-chevron`);
    const btn = document.getElementById(`${section}-toggle-btn`);
    if (!panel) return;
    const isHidden = panel.classList.toggle('hidden');
    if (chevron) chevron.innerHTML = isHidden ? '&#x25B2;' : '&#x25BC;';
    if (btn) btn.classList.toggle('footer-link-btn--active', !isHidden);
}

// ===== UTILS =====

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function attachFormListeners(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.querySelectorAll('input, select, textarea').forEach(el => {
        el.removeEventListener('input', markDirty);
        el.addEventListener('input', markDirty);
    });
}

// ===== INIT =====
checkAuth();
