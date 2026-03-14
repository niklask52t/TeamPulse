// ===== EVENTS =====

async function loadEvents() {
    const list = document.getElementById('events-list');
    try {
        const res = await apiFetch(`${API}/api/events`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const events = await res.json();

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
                    <p>${e.event_time} Uhr | Frist: ${fmtHours(e.poll_deadline_minutes)} vor Event</p>
                </div>
                <div class="card-actions">
                    <button class="btn btn-secondary btn-sm" onclick="editEvent(${e.id})">Bearbeiten</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteEvent(${e.id})">Löschen</button>
                </div>
            </div>`;
        }).join('') || '<p style="color:var(--text-secondary)">Noch keine Events erstellt.</p>';
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') {
            list.innerHTML = '<p style="color:var(--red)">Fehler beim Laden der Events: ' + esc(err.message) + '</p>';
        }
    }
}

function showEventForm() {
    if (!checkDirtyAndClose()) return;
    clearDirty();
    document.getElementById('events-list').innerHTML = '';
    document.getElementById('event-form').classList.remove('hidden');
    document.getElementById('event-form-title').textContent = 'Neues Event';
    document.getElementById('event-id').value = '';
    document.getElementById('event-title').value = '';
    document.getElementById('event-type').value = 'training';
    document.getElementById('event-time').value = '';
    document.getElementById('event-date').value = '';
    document.getElementById('event-date').min = todayStr();
    document.getElementById('event-recurring').checked = false;
    document.getElementById('event-deadline').value = '24';
    document.getElementById('event-group-post').value = '1';
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
    document.getElementById('event-date').min = '';
    document.getElementById('event-recurring').checked = !!e.recurring;
    document.getElementById('event-recurrence-day').value = e.recurrence_day ?? 1;
    document.getElementById('event-deadline').value = e.poll_deadline_minutes / 60;
    document.getElementById('event-group-post').value = e.group_post_minutes_before / 60;
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
        poll_deadline_minutes: Math.round(Number(document.getElementById('event-deadline').value) * 60),
        group_post_minutes_before: Math.round(Number(document.getElementById('event-group-post').value) * 60),
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
