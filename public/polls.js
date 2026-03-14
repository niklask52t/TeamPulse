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

    let html = active.map(renderPollCard).join('') || '<p style="color:var(--text-secondary)">Noch keine Umfragen vorhanden.</p>';

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

    const yes     = poll.responses.filter(r => r.response === 'yes');
    const no      = poll.responses.filter(r => r.response === 'no');
    const maybe   = poll.responses.filter(r => r.response === 'maybe');
    const pending = poll.responses.filter(r => !r.response);

    const actions = buildActionButtons(poll);

    detail.innerHTML = `
        <div class="poll-actions">${actions}</div>
        <div class="stats">
            <span class="stat response-yes">✅ ${yes.length}</span>
            <span class="stat response-no">❌ ${no.length}</span>
            <span class="stat response-maybe">🤷 ${maybe.length}</span>
            <span class="stat response-pending">⏳ ${pending.length}</span>
        </div>
        <div class="response-groups">
            ${renderResponseGroup('✅ Zusagen', yes, 'yes')}
            ${renderResponseGroup('❌ Absagen', no, 'no')}
            ${renderMaybeGroup(maybe)}
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

function renderMaybeGroup(responses) {
    if (responses.length === 0) return '';
    const items = responses.map(r => {
        const reason = r.reason
            ? ` <span class="response-reason">– <em>${esc(r.reason)}</em></span>`
            : '';
        return `<span class="response-maybe-item">${esc(r.name)}${reason}</span>`;
    }).join('');
    return `
        <div class="response-group">
            <div class="response-group-label response-maybe">🤷 Vielleicht (${responses.length})</div>
            <div class="response-names response-names--maybe">${items}</div>
        </div>`;
}

function buildActionButtons(poll) {
    const btns = [];

    if (poll.status === 'pending' && !poll.sent_at) {
        btns.push(`<button class="btn btn-primary btn-sm" onclick="pollAction(${poll.id}, 'send', 'Umfrage in Gruppe senden?')">Jetzt Umfrage senden</button>`);
    }
    if (poll.status === 'active') {
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'send-reminder', 'Erinnerung an alle ohne Antwort senden?')">Jetzt Erinnerung senden</button>`);
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'close', 'Umfrage jetzt manuell schließen?')">Umfrage schließen</button>`);
    }
    if (poll.status === 'active' || poll.status === 'closed') {
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'post-group', 'Ergebnis jetzt in Gruppe posten?')">Jetzt Ergebnis posten</button>`);
        btns.push(`<button class="btn btn-secondary btn-sm" onclick="pollAction(${poll.id}, 'send-event-reminder', 'Event-Erinnerung an alle Zusager senden?')">Jetzt Event-Erinnerung</button>`);
    }
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
