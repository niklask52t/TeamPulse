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
        return `
        <tr class="stats-row">
            <td class="stats-name">${esc(m.name)}</td>
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
