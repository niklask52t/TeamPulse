const API = '';

// Navigation
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

// ===== EVENTS =====

async function loadEvents() {
    const res = await fetch(`${API}/api/events`);
    const events = await res.json();
    const list = document.getElementById('events-list');

    const typeLabels = { training: 'Training', tournament: 'Turnier', other: 'Sonstiges' };
    const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

    list.innerHTML = events.map(e => {
        const recurring = e.recurring ? `<span class="badge badge-recurring">Jeden ${dayNames[e.recurrence_day]}</span>` : '';
        const date = e.event_date ? e.event_date : '';
        return `
        <div class="card">
            <div class="card-info">
                <h3>${esc(e.title)} <span class="badge badge-${e.type}">${typeLabels[e.type]}</span> ${recurring}</h3>
                <p>${date} ${e.event_time} Uhr | Abstimmungsfrist: ${e.poll_deadline_minutes} min vor Event</p>
            </div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-sm" onclick="editEvent(${e.id})">Bearbeiten</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEvent(${e.id})">Loeschen</button>
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
}

function toggleRecurring() {
    const checked = document.getElementById('event-recurring').checked;
    document.getElementById('recurring-fields').classList.toggle('hidden', !checked);
    document.getElementById('date-field').classList.toggle('hidden', checked);
}

async function editEvent(id) {
    const res = await fetch(`${API}/api/events/${id}`);
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
        await fetch(`${API}/api/events/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    } else {
        await fetch(`${API}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    }

    hideEventForm();
    loadEvents();
}

async function deleteEvent(id) {
    if (!confirm('Event wirklich loeschen?')) return;
    await fetch(`${API}/api/events/${id}`, { method: 'DELETE' });
    loadEvents();
}

// ===== CONTACTS =====

async function loadContacts() {
    const res = await fetch(`${API}/api/contacts`);
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
                <button class="btn btn-danger btn-sm" onclick="deleteContact(${c.id})">Loeschen</button>
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
        await fetch(`${API}/api/contacts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    } else {
        await fetch(`${API}/api/contacts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    }

    hideContactForm();
    loadContacts();
}

async function deleteContact(id) {
    if (!confirm('Kontakt wirklich loeschen?')) return;
    await fetch(`${API}/api/contacts/${id}`, { method: 'DELETE' });
    loadContacts();
}

// ===== POLLS =====

async function loadPolls() {
    const res = await fetch(`${API}/api/polls`);
    const polls = await res.json();
    const list = document.getElementById('polls-list');

    const statusLabels = { pending: 'Ausstehend', active: 'Aktiv', closed: 'Geschlossen' };

    list.innerHTML = polls.map(p => `
        <div class="card" style="cursor:pointer" onclick="togglePollDetail(${p.id}, this)">
            <div class="card-info">
                <h3>${esc(p.title)} <span class="badge badge-${p.status}">${statusLabels[p.status]}</span></h3>
                <p>${p.event_date} ${p.event_time} Uhr | Frist: ${new Date(p.deadline).toLocaleString('de-DE')}</p>
            </div>
            <div class="card-actions">
                ${p.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); sendPoll(${p.id})">Senden</button>` : ''}
            </div>
        </div>
        <div id="poll-detail-${p.id}" class="poll-detail hidden"></div>
    `).join('') || '<p style="color:#8b949e">Noch keine Umfragen vorhanden.</p>';
}

async function togglePollDetail(id, cardEl) {
    const detail = document.getElementById(`poll-detail-${id}`);
    if (!detail.classList.contains('hidden')) {
        detail.classList.add('hidden');
        return;
    }

    const res = await fetch(`${API}/api/polls/${id}`);
    const poll = await res.json();

    const yes = poll.responses.filter(r => r.response === 'yes');
    const no = poll.responses.filter(r => r.response === 'no');
    const maybe = poll.responses.filter(r => r.response === 'maybe');
    const pending = poll.responses.filter(r => !r.response);

    detail.innerHTML = `
        <div class="stats">
            <span class="stat response-yes">Ja: ${yes.length}</span>
            <span class="stat response-no">Nein: ${no.length}</span>
            <span class="stat response-maybe">Vllt: ${maybe.length}</span>
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
}

async function sendPoll(id) {
    await fetch(`${API}/api/polls/${id}/send`, { method: 'POST' });
    loadPolls();
}

// ===== UTILS =====

function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Initial load
loadEvents();
loadContacts();
loadPolls();
