const API = '';
const TZ = 'Europe/Berlin';

// ===== UHRZEIT =====

function startClock() {
    function tick() {
        const now = new Date().toLocaleString('de-DE', {
            timeZone: TZ,
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        document.getElementById('header-clock').textContent = now;
    }
    tick();
    setInterval(tick, 1000);
}

function fmtDeadline(isoStr) {
    return new Date(isoStr).toLocaleString('de-DE', { timeZone: TZ });
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
    loadContacts();
    loadPolls();
    const savedTab = localStorage.getItem('activeTab') || 'events';
    activateTab(savedTab);
}

async function doLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

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
    const confirm = document.getElementById('change-password-confirm').value;
    const newUsername = document.getElementById('change-username').value;
    const errorEl = document.getElementById('change-error');

    if (newPassword !== confirm) {
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

// Helper: handle 401 on any API call
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
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');
    const tab = document.getElementById(tabId);
    if (tab) tab.classList.add('active');
    localStorage.setItem('activeTab', tabId);
}

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// ===== EVENTS =====

async function loadEvents() {
    const res = await apiFetch(`${API}/api/events`);
    const events = await res.json();
    const list = document.getElementById('events-list');

    const typeLabels = { training: 'Training', tournament: 'Turnier', other: 'Sonstiges' };
    const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

    list.innerHTML = events.map(e => {
        const recurring = e.recurring ? `<span class="badge badge-recurring">Jeden ${dayNames[e.recurrence_day]}</span>` : '';
        const date = e.event_date ? e.event_date : '';
        return `
        <div class="card" id="event-card-${e.id}">
            <div class="card-info">
                <h3>${esc(e.title)} <span class="badge badge-${e.type}">${typeLabels[e.type]}</span> ${recurring}</h3>
                <p>${date} ${e.event_time} Uhr | Abstimmungsfrist: ${e.poll_deadline_minutes} min vor Event</p>
            </div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-sm" onclick="editEvent(${e.id})">Bearbeiten</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEvent(${e.id})">Löschen</button>
            </div>
        </div>`;
    }).join('') || '<p style="color:#8b949e">Noch keine Events erstellt.</p>';
}

function showEventForm() {
    document.getElementById('event-form').classList.remove('hidden');
    document.getElementById('event-form-title').textContent = 'Neues Event';
    document.getElementById('event-id').value = '';
    document.getElementById('event-title').value = '';
    document.getElementById('event-type').value = 'training';
    document.getElementById('event-time').value = '';
    document.getElementById('event-date').value = '';
    document.getElementById('event-recurring').checked = false;
    document.getElementById('event-deadline').value = '120';
    document.getElementById('event-group-post').value = '60';
    toggleRecurring();
}

function hideEventForm() {
    document.getElementById('event-form').classList.add('hidden');
    document.querySelectorAll('[id^="event-card-"]').forEach(el => el.classList.remove('hidden'));
}

function toggleRecurring() {
    const checked = document.getElementById('event-recurring').checked;
    document.getElementById('recurring-fields').classList.toggle('hidden', !checked);
    document.getElementById('date-field').classList.toggle('hidden', checked);
}

async function editEvent(id) {
    const res = await apiFetch(`${API}/api/events/${id}`);
    const e = await res.json();
    document.getElementById('event-form').classList.remove('hidden');
    document.getElementById('event-form-title').textContent = 'Event bearbeiten';
    document.getElementById('event-id').value = e.id;
    document.getElementById('event-title').value = e.title;
    document.getElementById('event-type').value = e.type;
    document.getElementById('event-time').value = e.event_time;
    document.getElementById('event-date').value = e.event_date || '';
    document.getElementById('event-recurring').checked = !!e.recurring;
    document.getElementById('event-recurrence-day').value = e.recurrence_day ?? 1;
    document.getElementById('event-deadline').value = e.poll_deadline_minutes;
    document.getElementById('event-group-post').value = e.group_post_minutes_before;
    toggleRecurring();
    // Hide the card being edited to avoid duplicate appearance
    document.getElementById(`event-card-${id}`)?.classList.add('hidden');
    document.getElementById('event-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveEvent(e) {
    e.preventDefault();
    const id = document.getElementById('event-id').value;
    const data = {
        title: document.getElementById('event-title').value,
        type: document.getElementById('event-type').value,
        event_time: document.getElementById('event-time').value,
        recurring: document.getElementById('event-recurring').checked,
        recurrence_day: Number(document.getElementById('event-recurrence-day').value),
        event_date: document.getElementById('event-date').value || null,
        poll_deadline_minutes: Number(document.getElementById('event-deadline').value),
        group_post_minutes_before: Number(document.getElementById('event-group-post').value),
    };

    if (id) {
        await apiFetch(`${API}/api/events/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    } else {
        await apiFetch(`${API}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    }

    hideEventForm();
    loadEvents();
}

async function deleteEvent(id) {
    if (!confirm('Event wirklich löschen?')) return;
    try {
        await apiFetch(`${API}/api/events/${id}`, { method: 'DELETE' });
        loadEvents();
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler beim Löschen: ' + err.message);
    }
}

// ===== CONTACTS =====

async function loadContacts() {
    const res = await apiFetch(`${API}/api/contacts`);
    const contacts = await res.json();
    const list = document.getElementById('contacts-list');

    list.innerHTML = contacts.map(c => `
        <div class="card">
            <div class="card-info">
                <h3>${esc(c.name)}</h3>
                <p>${esc(c.phone)}</p>
            </div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-sm" onclick="editContact(${c.id}, '${esc(c.name)}', '${esc(c.phone)}')">Bearbeiten</button>
                <button class="btn btn-danger btn-sm" onclick="deleteContact(${c.id})">Löschen</button>
            </div>
        </div>
    `).join('') || '<p style="color:#8b949e">Noch keine Kontakte angelegt.</p>';
}

function showContactForm() {
    document.getElementById('contact-form').classList.remove('hidden');
    document.getElementById('contact-form-title').textContent = 'Neuer Kontakt';
    document.getElementById('contact-id').value = '';
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-phone').value = '';
}

function hideContactForm() {
    document.getElementById('contact-form').classList.add('hidden');
}

function editContact(id, name, phone) {
    document.getElementById('contact-form').classList.remove('hidden');
    document.getElementById('contact-form-title').textContent = 'Kontakt bearbeiten';
    document.getElementById('contact-id').value = id;
    document.getElementById('contact-name').value = name;
    document.getElementById('contact-phone').value = phone;
}

async function saveContact(e) {
    e.preventDefault();
    const id = document.getElementById('contact-id').value;
    const data = {
        name: document.getElementById('contact-name').value,
        phone: document.getElementById('contact-phone').value,
    };

    if (id) {
        await apiFetch(`${API}/api/contacts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    } else {
        await apiFetch(`${API}/api/contacts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    }

    hideContactForm();
    loadContacts();
}

async function deleteContact(id) {
    if (!confirm('Kontakt wirklich löschen?')) return;
    await apiFetch(`${API}/api/contacts/${id}`, { method: 'DELETE' });
    loadContacts();
}

// ===== POLLS =====

async function loadPolls() {
    const res = await apiFetch(`${API}/api/polls`);
    const polls = await res.json();
    const list = document.getElementById('polls-list');

    const statusLabels = { pending: 'Ausstehend', active: 'Aktiv', closed: 'Geschlossen' };

    const active = polls.filter(p => !p.archived);
    const archived = polls.filter(p => p.archived);

    const renderPollCard = (p) => `
        <div class="card" style="cursor:pointer" id="poll-card-${p.id}" onclick="togglePollDetail(${p.id})">
            <div class="card-info">
                <h3>${esc(p.title)} <span class="badge badge-${p.status}">${statusLabels[p.status]}</span></h3>
                <p>${p.event_date} ${p.event_time} Uhr | Frist: ${fmtDeadline(p.deadline)}</p>
            </div>
            <div class="card-actions">
                <span class="poll-chevron" id="poll-chevron-${p.id}">Details ▼</span>
            </div>
        </div>
        <div id="poll-detail-${p.id}" class="poll-detail hidden"></div>
    `;

    let html = active.map(renderPollCard).join('') || '<p style="color:#8b949e">Noch keine Umfragen vorhanden.</p>';

    if (archived.length > 0) {
        html += `
        <div class="archive-header" onclick="toggleArchive()">
            <span>Archiv (${archived.length})</span>
            <span id="archive-chevron">▼</span>
        </div>
        <div id="polls-archive" class="hidden">
            ${archived.map(renderPollCard).join('')}
        </div>`;
    }

    list.innerHTML = html;
}

async function togglePollDetail(id) {
    const detail = document.getElementById(`poll-detail-${id}`);
    const chevron = document.getElementById(`poll-chevron-${id}`);
    if (!detail.classList.contains('hidden')) {
        detail.classList.add('hidden');
        if (chevron) chevron.textContent = 'Details ▼';
        return;
    }
    await renderPollDetail(id);
    if (chevron) chevron.textContent = 'Details ▲';
}

async function renderPollDetail(id) {
    const detail = document.getElementById(`poll-detail-${id}`);
    const res = await apiFetch(`${API}/api/polls/${id}`);
    const poll = await res.json();

    const yes = poll.responses.filter(r => r.response === 'yes');
    const no = poll.responses.filter(r => r.response === 'no');
    const maybe = poll.responses.filter(r => r.response === 'maybe');
    const pending = poll.responses.filter(r => !r.response);

    const actions = buildActionButtons(poll);

    detail.innerHTML = `
        <div class="poll-actions">${actions}</div>
        <div class="stats">
            <span class="stat response-yes">✅ Ja: ${yes.length}</span>
            <span class="stat response-no">❌ Nein: ${no.length}</span>
            <span class="stat response-maybe">🤷 Vielleicht: ${maybe.length}</span>
            <span class="stat response-pending">⏳ Offen: ${pending.length}</span>
        </div>
        <div class="poll-responses">
            ${poll.responses.map(r => `
                <div class="response-row">
                    <span>${esc(r.name)}</span>
                    <span class="response-${r.response || 'pending'}">${
                        r.response === 'yes' ? '✅ Ja' :
                        r.response === 'no' ? '❌ Nein' :
                        r.response === 'maybe' ? '🤷 Vielleicht' : '⏳ Ausstehend'
                    }</span>
                </div>
            `).join('')}
        </div>
    `;
    detail.classList.remove('hidden');
    const chevron = document.getElementById(`poll-chevron-${id}`);
    if (chevron) chevron.textContent = 'Details ▲';
}

function buildActionButtons(poll) {
    const btns = [];

    if (poll.status === 'pending') {
        btns.push(`<button class="btn btn-primary btn-sm" onclick="pollAction(${poll.id}, 'send', 'Umfrage an alle senden?')">📤 Jetzt Umfrage senden</button>`);
    }
    if (poll.status === 'active') {
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'send-reminder', 'Erinnerung an alle ohne Antwort senden?')">🔔 Jetzt Erinnerung senden</button>`);
    }
    if (poll.status === 'active' || poll.status === 'closed') {
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'post-group', 'Ergebnis jetzt in Gruppe posten?')">📊 Jetzt Ergebnis in Gruppe posten</button>`);
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'send-event-reminder', 'Event-Erinnerung an alle Zusager senden?')">🏃 Jetzt Event-Erinnerung senden</button>`);
    }

    btns.push(`<button class="btn btn-danger btn-sm" onclick="deletePoll(${poll.id})">🗑️ Löschen</button>`);

    return btns.join('');
}

async function deletePoll(id) {
    if (!confirm('Umfrage wirklich löschen?')) return;
    try {
        await apiFetch(`${API}/api/polls/${id}`, { method: 'DELETE' });
        loadPolls();
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
}

function toggleArchive() {
    const archive = document.getElementById('polls-archive');
    const chevron = document.getElementById('archive-chevron');
    if (!archive) return;
    const hidden = archive.classList.toggle('hidden');
    chevron.textContent = hidden ? '▼' : '▲';
}

async function pollAction(id, action, confirmMsg) {
    if (!confirm(confirmMsg)) return;
    try {
        const res = await apiFetch(`${API}/api/polls/${id}/${action}`, { method: 'POST' });
        if (!res.ok) {
            const data = await res.json();
            alert('Fehler: ' + (data.error || 'Unbekannter Fehler'));
            return;
        }
        await renderPollDetail(id);
        loadPolls();
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
}

// ===== UTILS =====

function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Initial auth check
checkAuth();
