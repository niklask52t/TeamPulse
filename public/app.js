const API = '';
const TZ = 'Europe/Berlin';

// ===== CHANGELOG =====

const CHANGELOG = [
    {
        version: '1.3.0',
        date: '2026-03-13',
        changes: [
            { type: 'feature', text: 'Logo und neues Design (blau-grün Farbschema passend zum Logo)' },
            { type: 'feature', text: 'Sticky Header mit Logo' },
            { type: 'feature', text: 'Kalender-Datumskarten bei Events und Umfragen' },
            { type: 'feature', text: 'Wiki und Changelog im Footer statt als Tabs' },
            { type: 'fix', text: 'WAHA Webhook-Route wurde nie erreicht (kritischer Routing-Bug)' },
            { type: 'fix', text: 'Antwort-Erkennung: Einzelbuchstaben "n"/"j" matchten fälschlicherweise in längeren Wörtern' },
        ]
    },
    {
        version: '1.2.0',
        date: '2026-03-13',
        changes: [
            { type: 'feature', text: 'Native WhatsApp-Umfragen (Tap-to-Vote statt Textnachricht)' },
            { type: 'feature', text: 'Umfragen-Archiv (automatisch 1h nach Event-Ende)' },
            { type: 'feature', text: 'Umfragen manuell löschen' },
            { type: 'feature', text: 'Manuelle Aktionsbuttons (Umfrage senden, Erinnerung, Gruppen-Post, Event-Erinnerung)' },
            { type: 'feature', text: 'Live-Uhr (Europe/Berlin) im Header' },
            { type: 'feature', text: 'Wiki-Tab mit vollständiger Dokumentation' },
            { type: 'feature', text: 'Changelog-Tab mit Versionierung' },
            { type: 'feature', text: 'Tab-Zustand bleibt nach Reload erhalten' },
            { type: 'feature', text: 'Warnung bei ungespeicherten Änderungen' },
            { type: 'feature', text: 'Pflichtfeld-Validierung (Datum, Telefonnummer, etc.)' },
            { type: 'feature', text: 'Events in der Vergangenheit nicht mehr anlegbar' },
            { type: 'fix', text: 'Event löschen crasht nicht mehr den Server' },
            { type: 'fix', text: 'Umfrage wird nicht mehr sofort als geschlossen angezeigt' },
            { type: 'fix', text: 'Gruppen-Ergebnis wird erst nach Fristablauf gepostet' },
            { type: 'fix', text: 'Alle Zeiten korrekt in Europe/Berlin' },
            { type: 'fix', text: 'Bearbeitungs-Formular zeigt keine Duplikate mehr' },
            { type: 'fix', text: 'Server-Fehler werden jetzt geloggt (sichtbar in journalctl)' },
            { type: 'delete', text: 'Alte Text-Umfragen durch native WhatsApp-Polls ersetzt' },
        ]
    },
    {
        version: '1.1.0',
        date: '2026-03-13',
        changes: [
            { type: 'feature', text: 'Login-System mit Passwort-Änderung beim ersten Login' },
            { type: 'feature', text: 'Strikte Authentifizierung für alle Seiten' },
            { type: 'fix', text: 'Umlaute korrekt (ä, ö, ü, ß)' },
        ]
    },
    {
        version: '1.0.0',
        date: '2026-03-13',
        changes: [
            { type: 'feature', text: 'Events erstellen und verwalten (einmalig & wiederkehrend)' },
            { type: 'feature', text: 'Kontakte mit WhatsApp-Nummer pflegen' },
            { type: 'feature', text: 'Automatische WhatsApp-Umfragen via WAHA' },
            { type: 'feature', text: 'Antwort-Erkennung (Ja/Nein/Vielleicht)' },
            { type: 'feature', text: 'Automatischer Gruppen-Post mit Ergebnis' },
            { type: 'feature', text: 'Erinnerungen vor Deadline und Event' },
            { type: 'feature', text: 'Update-Script (update.sh) mit Reset-Modus' },
        ]
    }
];

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

function todayStr() {
    return new Date().toLocaleString('sv-SE', { timeZone: TZ }).split(' ')[0];
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
    loadContacts();
    loadPolls();
    renderChangelog();
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
    const confirmPw = document.getElementById('change-password-confirm').value;
    const newUsername = document.getElementById('change-username').value;
    const errorEl = document.getElementById('change-error');

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
    // Wiki/changelog are now in footer, not tabs — ignore if someone saved them
    if (tabId === 'wiki' || tabId === 'changelog') tabId = 'events';
    // Close any open forms when switching tabs
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
    hideContactForm();
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
        const dateDisplay = e.event_date ? fmtDateFancy(e.event_date) : '';
        return `
        <div class="card" id="event-card-${e.id}">
            ${dateDisplay}
            <div class="card-info">
                <h3>${esc(e.title)} <span class="badge badge-${e.type}">${typeLabels[e.type]}</span> ${recurring}</h3>
                <p>${e.event_time} Uhr | Frist: ${e.poll_deadline_minutes} min vor Event</p>
            </div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-sm" onclick="editEvent(${e.id})">Bearbeiten</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEvent(${e.id})">Löschen</button>
            </div>
        </div>`;
    }).join('') || '<p style="color:var(--text-secondary)">Noch keine Events erstellt.</p>';
}

function showEventForm() {
    if (!checkDirtyAndClose()) return;
    clearDirty();
    document.getElementById('event-form').classList.remove('hidden');
    document.getElementById('event-form-title').textContent = 'Neues Event';
    document.getElementById('event-id').value = '';
    document.getElementById('event-title').value = '';
    document.getElementById('event-type').value = 'training';
    document.getElementById('event-time').value = '';
    document.getElementById('event-date').value = '';
    document.getElementById('event-date').min = todayStr();
    document.getElementById('event-recurring').checked = false;
    document.getElementById('event-deadline').value = '120';
    document.getElementById('event-group-post').value = '60';
    toggleRecurring();
    attachFormListeners('event-form-el');
    document.getElementById('event-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideEventForm() {
    document.getElementById('event-form').classList.add('hidden');
    document.querySelectorAll('[id^="event-card-"]').forEach(el => el.classList.remove('hidden'));
    clearDirty();
}

function toggleRecurring() {
    const checked = document.getElementById('event-recurring').checked;
    document.getElementById('recurring-fields').classList.toggle('hidden', !checked);
    document.getElementById('date-field').classList.toggle('hidden', checked);
    // Date is required only for non-recurring
    document.getElementById('event-date').required = !checked;
}

async function editEvent(id) {
    if (!checkDirtyAndClose()) return;
    clearDirty();
    const res = await apiFetch(`${API}/api/events/${id}`);
    const e = await res.json();
    document.getElementById('event-form').classList.remove('hidden');
    document.getElementById('event-form-title').textContent = 'Event bearbeiten';
    document.getElementById('event-id').value = e.id;
    document.getElementById('event-title').value = e.title;
    document.getElementById('event-type').value = e.type;
    document.getElementById('event-time').value = e.event_time;
    document.getElementById('event-date').value = e.event_date || '';
    // Allow keeping existing past dates when editing, but min for new dates is today
    document.getElementById('event-date').min = '';
    document.getElementById('event-recurring').checked = !!e.recurring;
    document.getElementById('event-recurrence-day').value = e.recurrence_day ?? 1;
    document.getElementById('event-deadline').value = e.poll_deadline_minutes;
    document.getElementById('event-group-post').value = e.group_post_minutes_before;
    toggleRecurring();
    attachFormListeners('event-form-el');
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

    try {
        let res;
        if (id) {
            res = await apiFetch(`${API}/api/events/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        } else {
            res = await apiFetch(`${API}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        }
        if (!res.ok) {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Unbekannter Fehler'));
            return;
        }
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
        return;
    }

    hideEventForm();
    loadEvents();
    loadPolls();
}

async function deleteEvent(id) {
    if (!confirm('Event wirklich löschen? Alle zugehörigen Umfragen werden ebenfalls gelöscht.')) return;
    try {
        const res = await apiFetch(`${API}/api/events/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Unbekannter Fehler'));
            return;
        }
        loadEvents();
        loadPolls();
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
    if (!checkDirtyAndClose()) return;
    clearDirty();
    document.getElementById('contact-form').classList.remove('hidden');
    document.getElementById('contact-form-title').textContent = 'Neuer Kontakt';
    document.getElementById('contact-id').value = '';
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-phone').value = '';
    attachFormListeners('contact-form-el');
}

function hideContactForm() {
    document.getElementById('contact-form').classList.add('hidden');
    clearDirty();
}

function editContact(id, name, phone) {
    if (!checkDirtyAndClose()) return;
    clearDirty();
    document.getElementById('contact-form').classList.remove('hidden');
    document.getElementById('contact-form-title').textContent = 'Kontakt bearbeiten';
    document.getElementById('contact-id').value = id;
    document.getElementById('contact-name').value = name;
    document.getElementById('contact-phone').value = phone;
    attachFormListeners('contact-form-el');
}

async function saveContact(e) {
    e.preventDefault();
    const id = document.getElementById('contact-id').value;
    const data = {
        name: document.getElementById('contact-name').value,
        phone: document.getElementById('contact-phone').value,
    };

    try {
        let res;
        if (id) {
            res = await apiFetch(`${API}/api/contacts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        } else {
            res = await apiFetch(`${API}/api/contacts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        }
        if (!res.ok) {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Unbekannter Fehler'));
            return;
        }
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
        return;
    }

    hideContactForm();
    loadContacts();
}

async function deleteContact(id) {
    if (!confirm('Kontakt wirklich löschen?')) return;
    try {
        await apiFetch(`${API}/api/contacts/${id}`, { method: 'DELETE' });
        loadContacts();
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
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
            ${fmtDateFancy(p.event_date)}
            <div class="card-info">
                <h3>${esc(p.title)} <span class="badge badge-${p.status}">${statusLabels[p.status]}</span></h3>
                <p>${p.event_time} Uhr | Frist: ${fmtDeadline(p.deadline)}</p>
            </div>
            <div class="card-actions">
                <span class="poll-chevron" id="poll-chevron-${p.id}">Details &#x25BC;</span>
            </div>
        </div>
        <div id="poll-detail-${p.id}" class="poll-detail hidden"></div>
    `;

    let html = active.map(renderPollCard).join('') || '<p style="color:#8b949e">Noch keine Umfragen vorhanden.</p>';

    if (archived.length > 0) {
        html += `
        <div class="archive-header" onclick="toggleArchive()">
            <span>Archiv (${archived.length})</span>
            <span id="archive-chevron">&#x25BC;</span>
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
        if (chevron) chevron.innerHTML = 'Details &#x25BC;';
        return;
    }
    await renderPollDetail(id);
    if (chevron) chevron.innerHTML = 'Details &#x25B2;';
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
            <span class="stat response-yes">Ja: ${yes.length}</span>
            <span class="stat response-no">Nein: ${no.length}</span>
            <span class="stat response-maybe">Vielleicht: ${maybe.length}</span>
            <span class="stat response-pending">Offen: ${pending.length}</span>
        </div>
        <div class="poll-responses">
            ${poll.responses.map(r => `
                <div class="response-row">
                    <span>${esc(r.name)}</span>
                    <span class="response-${r.response || 'pending'}">${
                        r.response === 'yes' ? 'Ja' :
                        r.response === 'no' ? 'Nein' :
                        r.response === 'maybe' ? 'Vielleicht' : 'Ausstehend'
                    }</span>
                </div>
            `).join('')}
        </div>
    `;
    detail.classList.remove('hidden');
    const chevron = document.getElementById(`poll-chevron-${id}`);
    if (chevron) chevron.innerHTML = 'Details &#x25B2;';
}

function buildActionButtons(poll) {
    const btns = [];

    // Send poll: only once, only when pending
    if (poll.status === 'pending' && !poll.sent_at) {
        btns.push(`<button class="btn btn-primary btn-sm" onclick="pollAction(${poll.id}, 'send', 'Umfrage an alle senden?')">Jetzt Umfrage senden</button>`);
    }
    // Reminder: multiple times, only when active
    if (poll.status === 'active') {
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'send-reminder', 'Erinnerung an alle ohne Antwort senden?')">Jetzt Erinnerung senden</button>`);
    }
    // Group post & event reminder: multiple times, active or closed
    if (poll.status === 'active' || poll.status === 'closed') {
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'post-group', 'Ergebnis jetzt in Gruppe posten?')">Jetzt Ergebnis posten</button>`);
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'send-event-reminder', 'Event-Erinnerung an alle Zusager senden?')">Jetzt Event-Erinnerung</button>`);
    }
    // Delete: always
    btns.push(`<button class="btn btn-danger btn-sm" onclick="deletePoll(${poll.id})">Löschen</button>`);

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
    chevron.innerHTML = hidden ? '&#x25BC;' : '&#x25B2;';
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

// ===== CHANGELOG =====

function renderChangelog() {
    const list = document.getElementById('changelog-list');
    if (!list) return;

    const typeColors = {
        feature: { bg: '#23863633', color: '#3fb950', label: 'Feature' },
        fix: { bg: '#d2992233', color: '#e3b341', label: 'Fix' },
        delete: { bg: '#da363333', color: '#f85149', label: 'Entfernt' },
    };

    list.innerHTML = CHANGELOG.map(release => `
        <div class="changelog-release">
            <div class="changelog-header">
                <span class="changelog-version">v${release.version}</span>
                <span class="changelog-date">${release.date}</span>
            </div>
            <ul class="changelog-list">
                ${release.changes.map(c => {
                    const t = typeColors[c.type] || typeColors.feature;
                    return `<li>
                        <span class="changelog-tag" style="background:${t.bg};color:${t.color}">${t.label}</span>
                        ${esc(c.text)}
                    </li>`;
                }).join('')}
            </ul>
        </div>
    `).join('');
}

// ===== FOOTER =====

function toggleFooterSection(section) {
    const content = document.getElementById(`footer-${section}`);
    const chevron = document.getElementById(`${section}-chevron`);
    if (!content) return;
    const hidden = content.classList.toggle('hidden');
    if (chevron) chevron.innerHTML = hidden ? '&#x25BC;' : '&#x25B2;';
}

// ===== DATE FORMATTING =====

function fmtDateFancy(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00Z');
    const day = d.getUTCDate();
    const month = d.toLocaleString('de-DE', { month: 'short', timeZone: 'UTC' });
    const weekday = d.toLocaleString('de-DE', { weekday: 'short', timeZone: 'UTC' });
    return `<span class="date-card"><span class="date-card-day">${day}</span><span class="date-card-month">${weekday}, ${month}</span></span>`;
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

// Initial auth check
checkAuth();
