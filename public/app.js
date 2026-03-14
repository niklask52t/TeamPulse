// ===== CORE CONFIG =====
const API = '';
const TZ = 'Europe/Berlin';

// ===== DATE / TIME HELPERS =====

function startClock() {
    function tick() {
        document.getElementById('header-clock').textContent = new Date().toLocaleString('de-DE', {
            timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit',
            year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    }
    tick();
    setInterval(tick, 1000);
}

// Format minutes as human-readable hours (e.g. 90 → "1.5h", 30 → "30 Min")
function fmtHours(minutes) {
    if (!minutes) return '—';
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    if (minutes < 60) return `${minutes} Min`;
    return `${(minutes / 60).toFixed(1).replace('.0', '')}h`;
}

function fmtDeadline(isoStr) {
    return new Date(isoStr).toLocaleString('de-DE', { timeZone: TZ });
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
    loadEvents();
    loadPolls();
    loadStats();
    renderChangelog();
    const savedTab = localStorage.getItem('activeTab') || 'events';
    activateTab(savedTab);
}

async function doLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl  = document.getElementById('login-error');

    const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    const res = await fetch(`${API}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    await fetch(`${API}/api/auth/logout`, { method: 'POST' });
    showLogin();
}

async function apiFetch(url, options) {
    const res = await fetch(url, options);
    if (res.status === 401) {
        showLogin();
        throw new Error('Nicht angemeldet');
    }
    return res;
}

// ===== NAVIGATION =====

function activateTab(tabId) {
    if (['wiki', 'changelog', 'contacts'].includes(tabId)) tabId = 'events';
    if (tabId === 'stats') loadStats();
    if (!checkDirtyAndClose()) return;
    hideAllForms();

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
}

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// ===== GROUPS =====

let groupsLoaded = false;

async function loadGroups() {
    const list = document.getElementById('groups-list');
    if (!list) return;
    list.innerHTML = '<p style="color:var(--text-secondary)">Gruppen werden geladen...</p>';
    try {
        const res = await apiFetch(`${API}/api/groups`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const groups = await res.json();
        if (!groups.length) {
            list.innerHTML = '<p style="color:var(--text-secondary)">Keine Gruppen gefunden.</p>';
            return;
        }
        const currentGroup = '${API}' ? '' : (document.cookie || '');
        const rows = groups.map(g => {
            const id = g.id || g._id || g.chatId || '';
            const name = g.name || g.subject || g.title || id;
            return '<tr>'
                + '<td class="stats-name">' + esc(name) + '</td>'
                + '<td style="font-family:monospace;font-size:0.82rem;color:var(--text-secondary);user-select:all">' + esc(id) + '</td>'
                + '<td><button class="btn btn-secondary btn-sm" onclick="copyGroupId(\'' + esc(id).replace(/'/g, "\\'") + '\')">Kopieren</button></td>'
                + '</tr>';
        }).join('');
        list.innerHTML = '<table class="stats-table">'
            + '<thead><tr><th>Gruppenname</th><th>Gruppen-ID</th><th></th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table>';
        groupsLoaded = true;
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') {
            list.innerHTML = '<p style="color:var(--red)">Fehler beim Laden: ' + esc(err.message) + '</p>';
        }
    }
}

function copyGroupId(id) {
    navigator.clipboard.writeText(id).then(() => {
        // brief visual feedback not needed — clipboard is enough
    }).catch(() => {
        prompt('Gruppen-ID:', id);
    });
}

// ===== FOOTER =====

function toggleFooterSection(section) {
    const panel = document.getElementById(`footer-${section}`);
    const chevron = document.getElementById(`${section}-chevron`);
    const btn = document.getElementById(`${section}-toggle-btn`);
    if (!panel) return;
    const isHidden = panel.classList.toggle('hidden');
    if (chevron) chevron.innerHTML = isHidden ? '&#x25B2;' : '&#x25BC;';
    if (btn) btn.classList.toggle('footer-link-btn--active', !isHidden);
    // Lazy-load groups on first open
    if (section === 'groups' && !isHidden && !groupsLoaded) loadGroups();
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
