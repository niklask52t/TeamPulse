// ===== POLLS =====

const openPollDetails = new Set();
let pollAutoRefreshTimer = null;

function startPollAutoRefresh() {
    if (pollAutoRefreshTimer) return;
    pollAutoRefreshTimer = setInterval(async () => {
        for (const id of openPollDetails) {
            try {
                await renderPollDetail(id);
            } catch {
                // ignore refresh errors
            }
        }
    }, 15000);
}

async function loadPolls() {
    const res = await apiFetch(`${API}/api/polls`);
    const polls = await res.json();
    const list = document.getElementById('polls-list');

    const statusLabels = { pending: 'Ausstehend', active: 'Aktiv', closed: 'Geschlossen', sending: 'Wird gesendet' };
    const sortAsc = (a, b) => (a.event_date + a.event_time).localeCompare(b.event_date + b.event_time);
    const sortDesc = (a, b) => (b.event_date + b.event_time).localeCompare(a.event_date + a.event_time);
    const activePending = polls.filter((poll) => !poll.archived && poll.status === 'pending').sort(sortAsc);
    const activeNonPending = polls.filter((poll) => !poll.archived && poll.status !== 'pending').sort(sortAsc);
    const archived = polls.filter((poll) => poll.archived).sort(sortDesc);

    const renderPollCard = (poll) => `
        <div class="card" style="cursor:pointer" id="poll-card-${poll.id}" onclick="togglePollDetail(${poll.id})">
            ${fmtDateFancy(poll.event_date)}
            <div class="card-info">
                <h3>${esc(poll.title)} <span class="badge badge-${poll.status}">${statusLabels[poll.status]}</span></h3>
                <p>${poll.event_time} Uhr | Frist: ${fmtDeadline(poll.deadline)}</p>
                ${poll.description ? `<p style="color:var(--text-secondary);font-size:0.85rem;margin-top:0.25rem">📝 ${esc(poll.description)}</p>` : ''}
            </div>
            <div class="card-actions">
                <span class="poll-chevron" id="poll-chevron-${poll.id}">Details &#x25BC;</span>
            </div>
        </div>
        <div id="poll-detail-${poll.id}" class="poll-detail hidden"></div>
    `;

    let html = activeNonPending.map(renderPollCard).join('');
    if (activeNonPending.length === 0 && activePending.length === 0) {
        html = '<p style="color:var(--text-secondary)">Noch keine Umfragen vorhanden.</p>';
    }

    if (activePending.length > 0) {
        html += `
        <div class="archive-header" onclick="togglePending()">
            <span>Ausstehend (${activePending.length})</span>
            <span id="pending-chevron">&#x25BC;</span>
        </div>
        <div id="polls-pending" class="hidden">
            ${activePending.map(renderPollCard).join('')}
        </div>`;
    }

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
        openPollDetails.delete(id);
        return;
    }
    await renderPollDetail(id);
    openPollDetails.add(id);
    startPollAutoRefresh();
    if (chevron) chevron.innerHTML = 'Details &#x25B2;';
}

async function openPollFromDashboard(id) {
    await activateTab('polls');
    await togglePollDetail(id);
}

async function renderPollDetail(id) {
    const detail = document.getElementById(`poll-detail-${id}`);
    const res = await apiFetch(`${API}/api/polls/${id}`);
    const poll = await res.json();

    const yes = poll.responses.filter((row) => row.response === 'yes');
    const no = poll.responses.filter((row) => row.response === 'no');
    const maybe = poll.responses.filter((row) => row.response === 'maybe');
    const pending = poll.responses.filter((row) => !row.response);

    const actions = buildActionButtons(poll);
    const autoCancelHtml = poll.auto_cancel && poll.min_participants > 0
        ? `<div class="poll-auto-cancel-info ${yes.length < poll.min_participants ? 'poll-auto-cancel-info--danger' : 'poll-auto-cancel-info--ok'}">Auto-Absage bei &lt; ${poll.min_participants} Zusagen (aktuell: ${yes.length})</div>`
        : '';
    const descHtml = poll.description ? `<p style="color:var(--text-secondary);margin:0.5rem 0">📝 ${esc(poll.description)}</p>` : '';

    detail.innerHTML = `
        <div class="poll-actions">${actions}</div>
        ${autoCancelHtml}
        ${descHtml}
        <div class="stats">
            <span class="stat response-yes">✅ ${yes.length}</span>
            <span class="stat response-no">❌ ${no.length}</span>
            <span class="stat response-maybe">🤔 ${maybe.length}</span>
            <span class="stat response-pending">⏳ ${pending.length}</span>
        </div>
        <div class="response-groups">
            ${renderReasonGroup('✅ Zusagen', yes, 'yes', poll.id, true)}
            ${renderReasonGroup('❌ Absagen', no, 'no', poll.id, true)}
            ${renderReasonGroup('🤔 Vielleicht', maybe, 'maybe', poll.id, true)}
            ${renderResponseGroup('⏳ Noch ausstehend', pending, 'pending', poll.id, true)}
        </div>
    `;
    detail.classList.remove('hidden');
    const chevron = document.getElementById(`poll-chevron-${id}`);
    if (chevron) chevron.innerHTML = 'Details &#x25B2;';
}

function renderResponseGroup(label, responses, type, pollId, editable) {
    if (responses.length === 0) return '';
    const names = responses.map((row) => {
        if (editable) {
            return `<span class="response-name-editable" onclick="showVotePicker(event, ${pollId}, ${row.contact_id}, '${esc(row.name)}')">${esc(row.name)}</span>`;
        }
        return esc(row.name);
    }).join(', ');
    return `
        <div class="response-group">
            <div class="response-group-label response-${type}">${label} (${responses.length})</div>
            <div class="response-names">${names}</div>
        </div>`;
}

function renderReasonGroup(label, responses, type, pollId, editable) {
    if (responses.length === 0) return '';
    const hasReasons = responses.some((row) => row.reason);
    if (!hasReasons) return renderResponseGroup(label, responses, type, pollId, editable);

    const items = responses.map((row) => {
        const reason = row.reason
            ? ` <span class="response-reason">- <em>${esc(row.reason)}</em></span>`
            : '';
        if (editable) {
            return `<span class="response-maybe-item"><span class="response-name-editable" onclick="showVotePicker(event, ${pollId}, ${row.contact_id}, '${esc(row.name)}')">${esc(row.name)}</span>${reason}</span>`;
        }
        return `<span class="response-maybe-item">${esc(row.name)}${reason}</span>`;
    }).join('');

    return `
        <div class="response-group">
            <div class="response-group-label response-${type}">${label} (${responses.length})</div>
            <div class="response-names response-names--maybe">${items}</div>
        </div>`;
}

function showVotePicker(evt, pollId, contactId, name) {
    evt.stopPropagation();
    document.querySelectorAll('.vote-picker').forEach((el) => el.remove());

    const picker = document.createElement('div');
    picker.className = 'vote-picker';
    picker.innerHTML = `
        <span class="vote-picker-label">${name}:</span>
        <button onclick="setVote(${pollId}, ${contactId}, 'yes')" title="Ja">✅</button>
        <button onclick="setVote(${pollId}, ${contactId}, 'no')" title="Nein">❌</button>
        <button onclick="setVote(${pollId}, ${contactId}, 'maybe')" title="Vielleicht">🤔</button>
        <button onclick="setVote(${pollId}, ${contactId}, null)" title="Zurücksetzen">⏳</button>
        <button onclick="this.parentElement.remove()" title="Abbrechen" class="vote-picker-close">✕</button>
    `;
    evt.target.after(picker);
}

async function setVote(pollId, contactId, response) {
    try {
        const res = await apiFetch(`${API}/api/polls/${pollId}/response`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_id: contactId, response }),
        });
        if (!res.ok) {
            const data = await res.json();
            alert('Fehler: ' + (data.error || 'Unbekannter Fehler'));
            return;
        }
        document.querySelectorAll('.vote-picker').forEach((el) => el.remove());
        await renderPollDetail(pollId);
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
}

function buildActionButtons(poll) {
    const buttons = [];

    if (poll.status === 'pending' && !poll.sent_at) {
        buttons.push(`<button class="btn btn-primary btn-sm" onclick="pollAction(${poll.id}, 'send', 'Umfrage in Gruppe senden?')">Jetzt Umfrage senden</button>`);
    }
    if (poll.status === 'active') {
        buttons.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'send-reminder', 'Abstimmungs-Erinnerung an alle ohne Antwort senden?')">⏰ Abstimmungs-Erinnerung</button>`);
        buttons.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'resend', 'Alle Stimmen zurücksetzen und Umfrage neu in die Gruppe senden?')">🔁 Neu senden (Reset)</button>`);
        buttons.push(`<button class="btn btn-secondary btn-sm" onclick="closePollWithPrompt(${poll.id})">Umfrage schließen</button>`);
        buttons.push(`<button class="btn btn-secondary btn-sm" onclick="showExtendForm(${poll.id})">Frist verlängern</button>`);
    }
    if (poll.status === 'pending') {
        buttons.push(`<button class="btn btn-secondary btn-sm" onclick="showExtendForm(${poll.id})">Frist verlängern</button>`);
    }
    if (poll.status === 'active' || poll.status === 'closed') {
        buttons.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'post-group', 'Ergebnis jetzt in Gruppe posten?')">Ergebnis posten</button>`);
        buttons.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'send-event-reminder', 'Start-Erinnerung an alle Zusager senden?')">🏃 Start-Erinnerung (Zusager)</button>`);
    }

    return buttons.join('');
}

function togglePending() {
    const element = document.getElementById('polls-pending');
    const chevron = document.getElementById('pending-chevron');
    if (!element) return;
    const hidden = element.classList.toggle('hidden');
    chevron.innerHTML = hidden ? '&#x25BC;' : '&#x25B2;';
}

function toggleArchive() {
    const archive = document.getElementById('polls-archive');
    const chevron = document.getElementById('archive-chevron');
    if (!archive) return;
    const hidden = archive.classList.toggle('hidden');
    chevron.innerHTML = hidden ? '&#x25BC;' : '&#x25B2;';
}

function showExtendForm(pollId) {
    const existing = document.getElementById(`extend-form-${pollId}`);
    if (existing) {
        existing.remove();
        return;
    }

    const detail = document.getElementById(`poll-detail-${pollId}`);
    if (!detail) return;

    const form = document.createElement('div');
    form.id = `extend-form-${pollId}`;
    form.className = 'extend-form';
    form.innerHTML = `
        <label>Frist um <input type="number" id="extend-minutes-${pollId}" value="30" min="1" max="1440" style="width:70px"> Minuten verlängern</label>
        <button class="btn btn-primary btn-sm" onclick="submitExtend(${pollId})">Verlängern</button>
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('extend-form-${pollId}').remove()">Abbrechen</button>
    `;
    detail.querySelector('.poll-actions').after(form);
}

async function submitExtend(pollId) {
    const minutes = Number(document.getElementById(`extend-minutes-${pollId}`)?.value);
    if (!minutes || minutes < 1) {
        alert('Ungültige Minutenzahl');
        return;
    }

    try {
        const res = await apiFetch(`${API}/api/polls/${pollId}/extend`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ minutes }),
        });
        if (!res.ok) {
            const data = await res.json();
            alert('Fehler: ' + (data.error || 'Unbekannter Fehler'));
            return;
        }
        await renderPollDetail(pollId);
        loadPolls();
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
}

async function closePollWithPrompt(id) {
    if (!confirm('Umfrage jetzt manuell schließen?')) return;
    const postResults = confirm('Soll das Ergebnis jetzt auch direkt in die Gruppe gepostet werden?');

    try {
        const res = await apiFetch(`${API}/api/polls/${id}/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postResults }),
        });
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

closePollWithPrompt = async function(id) {
    const shouldClose = await showConfirmDialog('Umfrage jetzt manuell schließen?', {
        title: 'Umfrage schließen',
        confirmText: 'Ja',
        cancelText: 'Nein',
    });
    if (!shouldClose) return;

    const postResults = await showConfirmDialog('Soll das Ergebnis jetzt auch direkt in die Gruppe gepostet werden?', {
        title: 'Ergebnis posten',
        confirmText: 'Ja',
        cancelText: 'Nein',
    });

    try {
        const res = await apiFetch(`${API}/api/polls/${id}/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postResults }),
        });
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
};
