// ===== STATS =====

async function loadStats() {
    const res = await apiFetch(`${API}/api/stats`);
    const stats = await res.json();
    const list = document.getElementById('stats-list');

    if (!stats.length) {
        list.innerHTML = '<p style="color:var(--text-secondary)">Noch keine Daten vorhanden.</p>';
        return;
    }

    // Summary totals
    const totalPolls = stats[0]?.total_polls ?? 0;
    const avgRate = totalPolls > 0
        ? Math.round(stats.reduce((s, m) => s + m.response_rate, 0) / stats.length)
        : 0;

    const rows = stats.map(m => {
        const rate = m.response_rate;
        const rateColor = rate >= 80 ? 'var(--green)' : rate >= 50 ? '#f59e0b' : 'var(--danger)';
        const bar = `<div class="stat-bar-wrap">
            <div class="stat-bar" style="width:${rate}%;background:${rateColor}"></div>
        </div>`;
        const overrideHint = m.name_override ? `<div style="color:var(--text-secondary);font-size:0.75rem">Override aktiv</div>` : '';
        return `
        <tr class="stats-row">
            <td class="stats-name"><button class="linklike-btn" onclick='editStatsNameOverride(${m.id}, ${JSON.stringify(m.name)}, ${JSON.stringify(m.name_override)}, ${JSON.stringify(m.raw_name)})'>${esc(m.name)}</button>${overrideHint}</td>
            <td class="stats-num response-yes">${m.yes_count}</td>
            <td class="stats-num response-no">${m.no_count}</td>
            <td class="stats-num response-maybe">${m.maybe_count}</td>
            <td class="stats-num response-pending">${m.no_response_count}</td>
            <td class="stats-num">${m.total_polls}</td>
            <td class="stats-rate">
                <span style="color:${rateColor};font-weight:600">${rate}%</span>
                ${bar}
            </td>
        </tr>`;
    }).join('');

    list.innerHTML = `
        <div class="stats-summary">
            <span>📊 Abgeschlossene Umfragen: <strong>${totalPolls}</strong></span>
            <span>Ø Antwortquote: <strong>${avgRate}%</strong></span>
        </div>
        <div class="stats-table-wrap">
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th class="stats-num">✅ Ja</th>
                        <th class="stats-num">❌ Nein</th>
                        <th class="stats-num">🤷 Vllt</th>
                        <th class="stats-num">⏳ Offen</th>
                        <th class="stats-num">Gesamt</th>
                        <th class="stats-rate">Antwortquote</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

async function editStatsNameOverride(contactId, displayName, currentOverride, rawName) {
    const next = prompt(
        `Anzeigename für diese Person überschreiben?\n\nLeer lassen = automatischen Namen verwenden\nAutomatisch aktuell: ${rawName}`,
        currentOverride || ''
    );
    if (next === null) return;

    try {
        const res = await apiFetch(`${API}/api/contacts/${contactId}/override-name`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ override_name: next }),
        });
        if (!res.ok) {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Unbekannter Fehler'));
            return;
        }
        await loadStats();
        if (typeof loadPolls === 'function') await loadPolls();
        if (typeof loadDashboard === 'function') await loadDashboard();
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') alert('Fehler: ' + err.message);
    }
}
