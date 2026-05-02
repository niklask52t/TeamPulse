// ===== EVENTS =====

const eventDatePickers = new Map();

function destroyEventDatePicker(selector) {
    const existing = eventDatePickers.get(selector);
    if (existing) {
        existing.destroy();
        eventDatePickers.delete(selector);
    }
}

function initDatePicker(selector, options = {}) {
    const input = document.querySelector(selector);
    if (!input || typeof flatpickr !== 'function') return null;

    destroyEventDatePicker(selector);

    const minDate = options.allowPast ? null : (options.minDate || todayStr());
    const picker = flatpickr(input, {
        locale: (window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.de) ? window.flatpickr.l10ns.de : 'de',
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd.m.Y',
        allowInput: false,
        disableMobile: true,
        minDate,
        clickOpens: true,
        ...options,
    });

    eventDatePickers.set(selector, picker);
    return picker;
}

function initEventDatePickers(options = {}) {
    initDatePicker('#event-date', { allowPast: !!options.allowPastEventDate });
    initDatePicker('#event-send-date');
    initDatePicker('#event-deadline-date');
}

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
            const dateDisplay = fmtDateFancy(e.next_event_date || e.event_date);
            const endStr = e.end_time ? ` - ${e.end_time}` : '';
            const sendInfo = e.poll_send_at
                ? `Versand: ${e.poll_send_at.replace('T', ' ')}`
                : `Versand: ${fmtHours(e.poll_send_minutes_before || 2160)} vor Event`;
            const deadlineInfo = e.poll_deadline_at
                ? `Frist: ${e.poll_deadline_at.replace('T', ' ')}`
                : `Frist: ${fmtHours(e.poll_deadline_minutes)} vor Event`;
            const cancelInfo = e.auto_cancel ? ` | Auto-Absage: min. ${e.min_participants}` : '';
            const descInfo = e.description ? `<p style="color:var(--text-secondary);font-size:0.85rem;margin-top:0.25rem">📝 ${esc(e.description)}</p>` : '';
            return `
            <div class="card" id="event-card-${e.id}">
                ${dateDisplay}
                <div class="card-info">
                    <h3>${esc(e.title)} <span class="badge badge-${e.type}">${typeLabels[e.type]}</span> ${recurring}</h3>
                    <p>${e.event_time}${endStr} Uhr${e.meeting_time ? ' | Treffen: ' + e.meeting_time + ' Uhr' : ''} | ${sendInfo} | ${deadlineInfo}${cancelInfo}</p>
                    ${descInfo}
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
    document.getElementById('event-end-time').value = '';
    document.getElementById('event-meeting-time').value = '';
    document.getElementById('event-date').value = '';
    document.getElementById('event-date').min = todayStr();
    document.getElementById('event-recurring').checked = false;
    document.getElementById('event-send-before').value = '36';
    document.getElementById('event-deadline').value = '1';
    document.getElementById('send-mode-before').checked = true;
    document.getElementById('event-send-date').value = '';
    document.getElementById('event-send-time').value = '';
    document.getElementById('deadline-mode-before').checked = true;
    document.getElementById('event-deadline-date').value = '';
    document.getElementById('event-deadline-time').value = '';
    document.getElementById('event-description').value = '';
    document.getElementById('event-event-reminder-min').value = '60';
    document.getElementById('event-deadline-r1-min').value = '120';
    document.getElementById('event-deadline-r2-min').value = '15';
    document.getElementById('event-auto-cancel').checked = false;
    document.getElementById('event-min-participants').value = '8';
    toggleAutoCancel();
    toggleSendMode();
    toggleDeadlineMode();
    toggleRecurring();
    hideExceptionsSection();
    initEventDatePickers({ allowPastEventDate: false });
    attachFormListeners('event-form-el');
    document.getElementById('event-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideEventForm() {
    document.getElementById('event-form').classList.add('hidden');
    document.querySelectorAll('[id^="event-card-"]').forEach(el => el.classList.remove('hidden'));
    hideExceptionsSection();
    clearDirty();
}

function toggleRecurring() {
    const checked = document.getElementById('event-recurring').checked;
    document.getElementById('recurring-fields').classList.toggle('hidden', !checked);
    document.getElementById('date-field').classList.toggle('hidden', checked);
    document.getElementById('event-date').required = !checked;
    // Fixed send date not available for recurring events
    const fixedLabel = document.getElementById('send-mode-fixed-label');
    if (fixedLabel) {
        fixedLabel.classList.toggle('hidden', checked);
        if (checked && document.getElementById('send-mode-fixed').checked) {
            document.getElementById('send-mode-before').checked = true;
            toggleSendMode();
        }
    }
    // Fixed deadline date not available for recurring events
    const deadlineFixedLabel = document.getElementById('deadline-mode-fixed-label');
    if (deadlineFixedLabel) {
        deadlineFixedLabel.classList.toggle('hidden', checked);
        if (checked && document.getElementById('deadline-mode-fixed').checked) {
            document.getElementById('deadline-mode-before').checked = true;
            toggleDeadlineMode();
        }
    }
    // Show/hide exceptions section
    const excSection = document.getElementById('event-exceptions-section');
    if (excSection) excSection.classList.toggle('hidden', !checked);
}

function toggleSendMode() {
    const isFixed = document.getElementById('send-mode-fixed').checked;
    document.getElementById('send-before-field').classList.toggle('hidden', isFixed);
    document.getElementById('send-fixed-field').classList.toggle('hidden', !isFixed);
    document.getElementById('event-send-before').required = !isFixed;
    document.getElementById('event-send-date').required = isFixed;
    document.getElementById('event-send-time').required = isFixed;
}

function toggleDeadlineMode() {
    const isFixed = document.getElementById('deadline-mode-fixed').checked;
    document.getElementById('deadline-before-field').classList.toggle('hidden', isFixed);
    document.getElementById('deadline-fixed-field').classList.toggle('hidden', !isFixed);
    document.getElementById('event-deadline').required = !isFixed;
    document.getElementById('event-deadline-date').required = isFixed;
    document.getElementById('event-deadline-time').required = isFixed;
}

function toggleAutoCancel() {
    const checked = document.getElementById('event-auto-cancel').checked;
    document.getElementById('auto-cancel-fields').classList.toggle('hidden', !checked);
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
    document.getElementById('event-end-time').value = e.end_time || '';
    document.getElementById('event-meeting-time').value = e.meeting_time || '';
    document.getElementById('event-date').value = e.event_date || '';
    document.getElementById('event-date').min = '';
    document.getElementById('event-recurring').checked = !!e.recurring;
    document.getElementById('event-recurrence-day').value = e.recurrence_day ?? 1;
    if (e.poll_send_at) {
        document.getElementById('send-mode-fixed').checked = true;
        const [sendDate, sendTime] = e.poll_send_at.split('T');
        document.getElementById('event-send-date').value = sendDate || '';
        document.getElementById('event-send-time').value = sendTime || '';
        document.getElementById('event-send-before').value = '36';
    } else {
        document.getElementById('send-mode-before').checked = true;
        document.getElementById('event-send-before').value = (e.poll_send_minutes_before || 2160) / 60;
        document.getElementById('event-send-date').value = '';
        document.getElementById('event-send-time').value = '';
    }
    if (e.poll_deadline_at) {
        document.getElementById('deadline-mode-fixed').checked = true;
        const [dlDate, dlTime] = e.poll_deadline_at.split('T');
        document.getElementById('event-deadline-date').value = dlDate || '';
        document.getElementById('event-deadline-time').value = dlTime || '';
        document.getElementById('event-deadline').value = '1';
    } else {
        document.getElementById('deadline-mode-before').checked = true;
        document.getElementById('event-deadline').value = e.poll_deadline_minutes / 60;
        document.getElementById('event-deadline-date').value = '';
        document.getElementById('event-deadline-time').value = '';
    }
    toggleDeadlineMode();
    document.getElementById('event-description').value = e.description || '';
    document.getElementById('event-event-reminder-min').value = e.event_reminder_minutes ?? 60;
    document.getElementById('event-deadline-r1-min').value = e.deadline_reminder_1_minutes ?? 120;
    document.getElementById('event-deadline-r2-min').value = e.deadline_reminder_2_minutes ?? 15;
    document.getElementById('event-auto-cancel').checked = !!e.auto_cancel;
    document.getElementById('event-min-participants').value = e.min_participants || 8;
    toggleAutoCancel();
    toggleSendMode();
    toggleRecurring();
    initEventDatePickers({ allowPastEventDate: true });
    // Load exceptions for recurring events
    if (e.recurring) {
        loadEventExceptions(e.id);
    } else {
        hideExceptionsSection();
    }
    attachFormListeners('event-form-el');
    document.getElementById(`event-card-${id}`)?.classList.add('hidden');
    document.getElementById('event-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveEvent(e) {
    e.preventDefault();
    const id = document.getElementById('event-id').value;
    const isFixed = document.getElementById('send-mode-fixed').checked;
    const isDeadlineFixed = document.getElementById('deadline-mode-fixed').checked;
    const title = document.getElementById('event-title').value.trim();
    const type = document.getElementById('event-type').value;
    const eventTime = document.getElementById('event-time').value;
    const recurring = document.getElementById('event-recurring').checked;
    const eventDate = document.getElementById('event-date').value || null;
    const data = {
        title,
        type,
        event_time: eventTime,
        end_time: document.getElementById('event-end-time').value || null,
        meeting_time: document.getElementById('event-meeting-time').value || null,
        recurring,
        recurrence_day: Number(document.getElementById('event-recurrence-day').value),
        event_date: eventDate,
        poll_deadline_minutes: Math.round(Number(document.getElementById('event-deadline').value) * 60),
        description: document.getElementById('event-description').value || null,
        event_reminder_minutes: Number(document.getElementById('event-event-reminder-min').value) || 60,
        deadline_reminder_1_minutes: Number(document.getElementById('event-deadline-r1-min').value) || 120,
        deadline_reminder_2_minutes: Number(document.getElementById('event-deadline-r2-min').value) || 15,
        auto_cancel: document.getElementById('event-auto-cancel').checked,
        min_participants: Number(document.getElementById('event-min-participants').value) || 0,
    };

    if (!title) {
        alert('Titel ist erforderlich.');
        document.getElementById('event-title').focus();
        return;
    }
    if (!type) {
        alert('Typ ist erforderlich.');
        document.getElementById('event-type').focus();
        return;
    }
    if (!eventTime) {
        alert('Uhrzeit ist erforderlich.');
        document.getElementById('event-time').focus();
        return;
    }
    if (!recurring && !eventDate) {
        alert('Datum ist erforderlich.');
        const eventDateInput = document.querySelector('#event-date') || document.getElementById('event-date');
        eventDateInput?.focus();
        return;
    }

    // Time validation
    if (data.meeting_time && data.meeting_time >= data.event_time) {
        alert('Treffenszeit muss vor der Event-Uhrzeit liegen.');
        return;
    }
    if (data.end_time && data.end_time <= data.event_time) {
        alert('Endzeit muss nach der Event-Uhrzeit liegen.');
        return;
    }

    if (isFixed) {
        const sendDate = document.getElementById('event-send-date').value;
        const sendTime = document.getElementById('event-send-time').value;
        if (!sendDate || !sendTime) { alert('Versand-Datum und Uhrzeit sind erforderlich'); return; }
        data.poll_send_at = `${sendDate}T${sendTime}`;
        data.poll_send_minutes_before = null;
    } else {
        data.poll_send_at = null;
        data.poll_send_minutes_before = Math.round(Number(document.getElementById('event-send-before').value) * 60);
    }

    if (isDeadlineFixed) {
        const dlDate = document.getElementById('event-deadline-date').value;
        const dlTime = document.getElementById('event-deadline-time').value;
        if (!dlDate || !dlTime) { alert('Frist-Datum und Uhrzeit sind erforderlich'); return; }
        data.poll_deadline_at = `${dlDate}T${dlTime}`;
        data.poll_deadline_minutes = null;
    } else {
        data.poll_deadline_at = null;
    }

    // Warn if creating a new event while 2+ polls are already active
    if (!id) {
        try {
            const acRes = await apiFetch(`${API}/api/polls/active-count`);
            const { count } = await acRes.json();
            if (count >= 2) {
                const confirmed = await showConfirmDialog(
                    'Es sind bereits ' + count + ' Umfragen aktiv. Die neue Umfrage wird erstellt, erscheint aber erst in der Gruppenbeschreibung, sobald wieder Platz ist. Trotzdem erstellen?',
                    { title: 'Viele aktive Umfragen', confirmText: 'Ja', cancelText: 'Nein' }
                );
                if (!confirmed) return;
            }
        } catch (_) { /* ignore, proceed */ }
    }

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

// ===== EVENT EXCEPTIONS =====

function hideExceptionsSection() {
    const section = document.getElementById('event-exceptions-section');
    if (section) section.remove();
}

async function loadEventExceptions(eventId) {
    hideExceptionsSection();
    const form = document.getElementById('event-form');
    if (!form) return;

    const section = document.createElement('div');
    section.id = 'event-exceptions-section';
    section.className = 'exceptions-section';
    section.innerHTML = `
        <h4>Ausnahmen (Termine aussetzen)</h4>
        <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;align-items:end">
            <div class="form-group" style="margin:0;flex:1">
                <label>Datum</label>
                <input type="date" id="exception-date" min="${todayStr()}">
            </div>
            <div class="form-group" style="margin:0;flex:1">
                <label>Grund (optional)</label>
                <input type="text" id="exception-reason" placeholder="z.B. Feiertag">
            </div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="addException(${eventId})">Aussetzen</button>
        </div>
        <div id="exceptions-list"></div>
    `;
    form.querySelector('.form-actions').before(section);
    initDatePicker('#exception-date');

    try {
        const res = await apiFetch(`${API}/api/events/${eventId}/exceptions`);
        const exceptions = await res.json();
        const list = document.getElementById('exceptions-list');
        if (exceptions.length === 0) {
            list.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem">Keine Ausnahmen.</p>';
        } else {
            list.innerHTML = exceptions.map(ex => {
                const d = ex.exception_date.split('-');
                const dateStr = `${d[2]}.${d[1]}.${d[0]}`;
                return `<div class="exception-item">
                    <span>${dateStr}${ex.reason ? ' — ' + esc(ex.reason) : ''}</span>
                    <button type="button" class="btn btn-danger btn-sm" onclick="removeException(${eventId}, ${ex.id})">Entfernen</button>
                </div>`;
            }).join('');
        }
    } catch { /* ignore */ }
}

async function addException(eventId) {
    const date = document.getElementById('exception-date').value;
    const reason = document.getElementById('exception-reason').value;
    if (!date) { alert('Datum ist erforderlich'); return; }
    try {
        const res = await apiFetch(`${API}/api/events/${eventId}/exceptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ exception_date: date, reason: reason || null }),
        });
        if (!res.ok) {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Unbekannter Fehler'));
            return;
        }
        loadEventExceptions(eventId);
        loadPolls();
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
}

async function removeException(eventId, exceptionId) {
    try {
        const res = await apiFetch(`${API}/api/events/${eventId}/exceptions/${exceptionId}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Unbekannter Fehler'));
            return;
        }
        loadEventExceptions(eventId);
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
}

deleteEvent = async function(id) {
    const confirmed = await showConfirmDialog('Event wirklich löschen? Alle zugehörigen Umfragen werden ebenfalls gelöscht.', {
        title: 'Event löschen',
        confirmText: 'Ja',
        cancelText: 'Nein',
    });
    if (!confirmed) return;

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
};
