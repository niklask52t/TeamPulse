// ===== POLLS =====

// Track which poll details are open for auto-refresh
const openPollDetails = new Set();
let pollAutoRefreshTimer = null;

function startPollAutoRefresh() {
    if (pollAutoRefreshTimer) return;
    pollAutoRefreshTimer = setInterval(async () => {
        for (const id of openPollDetails) {
            try { await renderPollDetail(id); } catch { /* ignore */ }
        }
    }, 15000); // every 15s
}

async function loadPolls() {
    const res = await apiFetch(`${API}/api/polls`);
    const polls = await res.json();
    const list = document.getElementById('polls-list');

    const statusLabels = { pending: 'Ausstehend', active: 'Aktiv', closed: 'Geschlossen' };

    const activePending = polls.filter(p => !p.archived && p.status === 'pending');
    const activeNonPending = polls.filter(p => !p.archived && p.status !== 'pending');
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

async function renderPollDetail(id) {
    const detail = document.getElementById(`poll-detail-${id}`);
    const res = await apiFetch(`${API}/api/polls/${id}`);
    const poll = await res.json();

    const yes     = poll.responses.filter(r => r.response === 'yes');
    const no      = poll.responses.filter(r => r.response === 'no');
    const maybe   = poll.responses.filter(r => r.response === 'maybe');
    const pending = poll.responses.filter(r => !r.response);

    const actions = buildActionButtons(poll);
    const autoCancelHtml = poll.auto_cancel && poll.min_participants > 0
        ? `<div class="poll-auto-cancel-info ${yes.length < poll.min_participants ? 'poll-auto-cancel-info--danger' : 'poll-auto-cancel-info--ok'}">Auto-Absage bei &lt; ${poll.min_participants} Zusagen (aktuell: ${yes.length})</div>`
        : '';

    detail.innerHTML = `
        <div class="poll-actions">${actions}</div>
        ${autoCancelHtml}
        <div class="stats">
            <span class="stat response-yes">✅ ${yes.length}</span>
            <span class="stat response-no">❌ ${no.length}</span>
            <span class="stat response-maybe">🤷 ${maybe.length}</span>
            <span class="stat response-pending">⏳ ${pending.length}</span>
        </div>
        <div class="response-groups">
            ${renderReasonGroup('✅ Zusagen', yes, 'yes')}
            ${renderReasonGroup('❌ Absagen', no, 'no')}
            ${renderReasonGroup('🤷 Vielleicht', maybe, 'maybe')}
            ${renderResponseGroup('⏳ Noch ausstehend', pending, 'pending')}
        </div>
    `;
    detail.classList.remove('hidden');
    const chevron = document.getElementById(`poll-chevron-${id}`);
    if (chevron) chevron.innerHTML = 'Details &#x25B2;';
}

function renderResponseGroup(label, responses, type) {
    if (responses.length === 0) return '';
    const names = responses.map(r => esc(r.name)).join(', ');
    return `
        <div class="response-group">
            <div class="response-group-label response-${type}">${label} (${responses.length})</div>
            <div class="response-names">${names}</div>
        </div>`;
}

function renderReasonGroup(label, responses, type) {
    if (responses.length === 0) return '';
    const hasReasons = responses.some(r => r.reason);
    if (!hasReasons) return renderResponseGroup(label, responses, type);
    const items = responses.map(r => {
        const reason = r.reason
            ? ` <span class="response-reason">– <em>${esc(r.reason)}</em></span>`
            : '';
        return `<span class="response-maybe-item">${esc(r.name)}${reason}</span>`;
    }).join('');
    return `
        <div class="response-group">
            <div class="response-group-label response-${type}">${label} (${responses.length})</div>
            <div class="response-names response-names--maybe">${items}</div>
        </div>`;
}

function buildActionButtons(poll) {
    const btns = [];

    if (poll.status === 'pending' && !poll.sent_at) {
        btns.push(`<button class="btn btn-primary btn-sm" onclick="pollAction(${poll.id}, 'send', 'Umfrage in Gruppe senden?')">Jetzt Umfrage senden</button>`);
    }
    if (poll.status === 'active') {
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'send-reminder', 'Abstimmungs-Erinnerung an alle ohne Antwort senden?')">⏰ Abstimmungs-Erinnerung</button>`);
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'close', 'Umfrage jetzt manuell schließen?')">Umfrage schließen</button>`);
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="showExtendForm(${poll.id})">Frist verlängern</button>`);
    }
    if (poll.status === 'pending') {
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="showExtendForm(${poll.id})">Frist verlängern</button>`);
    }
    if (poll.status === 'active' || poll.status === 'closed') {
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'post-group', 'Ergebnis jetzt in Gruppe posten?')">Ergebnis posten</button>`);
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'send-event-reminder', 'Start-Erinnerung an alle Zusager senden?')">🏃 Start-Erinnerung (Zusager)</button>`);
    }

    return btns.join('');
}


function togglePending() {
    const el = document.getElementById('polls-pending');
    const chevron = document.getElementById('pending-chevron');
    if (!el) return;
    const hidden = el.classList.toggle('hidden');
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
    if (existing) { existing.remove(); return; }
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
    if (!minutes || minutes < 1) { alert('Ungültige Minutenzahl'); return; }
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
