// ===== DASHBOARD =====

let dashboardCountdownTimer = null;

async function loadDashboard() {
    const content = document.getElementById('dashboard-content');
    if (!content) return;
    try {
        const res = await apiFetch(`${API}/api/dashboard`);
        const data = await res.json();
        content.innerHTML = renderDashboard(data);
        startDashboardCountdown(data.nextEvent);
    } catch (err) {
        if (err.message !== 'Nicht angemeldet') {
            content.innerHTML = '<p style="color:var(--red)">Fehler beim Laden des Dashboards.</p>';
        }
    }
}

function renderDashboard(data) {
    const { nextEvent, activePolls, quickStats, responseTrend } = data;

    // Quick stats row
    const statsHtml = `
        <div class="dashboard-stats">
            <div class="dashboard-stat">
                <span class="dashboard-stat-value">${quickStats.totalEvents}</span>
                <span class="dashboard-stat-label">Events</span>
            </div>
            <div class="dashboard-stat">
                <span class="dashboard-stat-value">${quickStats.totalMembers}</span>
                <span class="dashboard-stat-label">Mitglieder</span>
            </div>
            <div class="dashboard-stat">
                <span class="dashboard-stat-value">${quickStats.avgAttendanceRate}%</span>
                <span class="dashboard-stat-label">Antwortquote</span>
            </div>
            <div class="dashboard-stat">
                <span class="dashboard-stat-value">${quickStats.totalClosedPolls}</span>
                <span class="dashboard-stat-label">Abgeschlossen</span>
            </div>
        </div>`;

    // Next event card
    let nextEventHtml = '';
    if (nextEvent) {
        const typeLabels = { training: 'Training', tournament: 'Turnier', other: 'Sonstiges' };
        const endStr = nextEvent.end_time ? ` - ${nextEvent.end_time}` : '';
        const meetStr = nextEvent.meeting_time ? `<p>Treffen: ${nextEvent.meeting_time} Uhr</p>` : '';
        const descStr = nextEvent.description ? `<p style="color:var(--text-secondary);font-size:0.9rem">📝 ${esc(nextEvent.description)}</p>` : '';
        const cancelStr = nextEvent.auto_cancel ? `<p class="dashboard-auto-cancel">Auto-Absage bei &lt; ${nextEvent.min_participants} Zusagen</p>` : '';
        nextEventHtml = `
            <div class="dashboard-next-event">
                <div class="dashboard-next-event-header">
                    <h3>${esc(nextEvent.title)}</h3>
                    <span class="badge badge-${nextEvent.type}">${typeLabels[nextEvent.type] || nextEvent.type}</span>
                    <span class="badge badge-${nextEvent.status}">${nextEvent.status === 'pending' ? 'Ausstehend' : 'Aktiv'}</span>
                </div>
                <div class="dashboard-next-event-body">
                    <div class="dashboard-next-event-info">
                        ${fmtDateFancy(nextEvent.event_date)}
                        <div>
                            <p>${nextEvent.event_time}${endStr} Uhr</p>
                            ${meetStr}
                            ${descStr}
                            ${cancelStr}
                        </div>
                    </div>
                    <div class="dashboard-countdown" id="dashboard-countdown"></div>
                </div>
            </div>`;
    } else {
        nextEventHtml = '<div class="dashboard-next-event"><p style="color:var(--text-secondary)">Kein anstehendes Event.</p></div>';
    }

    // Active polls
    let pollsHtml = '';
    if (activePolls.length > 0) {
        pollsHtml = '<h3 class="dashboard-section-title">Aktive Umfragen</h3><div class="dashboard-polls-grid">';
        for (const p of activePolls) {
            const responded = p.yes_count + p.no_count + p.maybe_count;
            const pct = p.total > 0 ? Math.round(responded / p.total * 100) : 0;
            const cancelBadge = p.auto_cancel && p.min_participants > 0
                ? `<span class="dashboard-poll-cancel ${p.yes_count < p.min_participants ? 'dashboard-poll-cancel--danger' : 'dashboard-poll-cancel--ok'}">${p.yes_count}/${p.min_participants} min.</span>`
                : '';
            pollsHtml += `
                <div class="dashboard-poll-card" onclick="openPollFromDashboard(${p.id})">
                    <div class="dashboard-poll-header">
                        <strong>${esc(p.title)}</strong>
                        ${cancelBadge}
                    </div>
                    <p class="dashboard-poll-date">${fmtDateFancy(p.event_date)} ${p.event_time} Uhr</p>
                    ${p.description ? `<p style="color:var(--text-secondary);font-size:0.8rem;margin:0.2rem 0 0">📝 ${esc(p.description)}</p>` : ''}
                    <div class="dashboard-poll-progress">
                        <div class="dashboard-poll-bar" style="width:${pct}%"></div>
                    </div>
                    <div class="dashboard-poll-stats">
                        <span class="response-yes">✅ ${p.yes_count}</span>
                        <span class="response-no">❌ ${p.no_count}</span>
                        <span class="response-maybe">🤷 ${p.maybe_count}</span>
                        <span class="response-pending">⏳ ${p.pending_count}</span>
                    </div>
                </div>`;
        }
        pollsHtml += '</div>';
    }

    // Response trend
    let trendHtml = '';
    if (responseTrend.length > 0) {
        trendHtml = '<h3 class="dashboard-section-title">Letzte Umfragen</h3>';
        trendHtml += '<div class="dashboard-trend-legend"><span class="dashboard-trend-legend-item"><span class="dashboard-trend-legend-dot" style="background:var(--green)"></span>Zusagen</span><span class="dashboard-trend-legend-item"><span class="dashboard-trend-legend-dot" style="background:var(--text-secondary);opacity:0.4"></span>Sonstige Antworten</span></div>';
        trendHtml += '<div class="dashboard-trend">';
        const trendReversed = [...responseTrend].reverse();
        for (const t of trendReversed) {
            const rate = t.total > 0 ? Math.round(t.responded / t.total * 100) : 0;
            const yesRate = t.total > 0 ? Math.round(t.yes_count / t.total * 100) : 0;
            const color = rate >= 80 ? 'var(--green)' : rate >= 50 ? '#f59e0b' : 'var(--danger)';
            const [y, m, d] = t.event_date.split('-');
            const dateLabel = `${d}.${m}.`;
            trendHtml += `
                <div class="dashboard-trend-item" title="${esc(t.title)} — ${d}.${m}.${y}\n✅ ${t.yes_count} Zusagen | ${t.responded}/${t.total} Antworten (${rate}%)">
                    <div class="dashboard-trend-bar-wrap">
                        <div class="dashboard-trend-bar" style="height:${rate}%;background:${color}"></div>
                        <div class="dashboard-trend-bar-yes" style="height:${yesRate}%;background:var(--green)"></div>
                    </div>
                    <span class="dashboard-trend-pct">${rate}%</span>
                    <span class="dashboard-trend-date">${dateLabel}</span>
                    <span class="dashboard-trend-title">${esc(t.title)}</span>
                </div>`;
        }
        trendHtml += '</div>';
    }

    return statsHtml + nextEventHtml + pollsHtml + trendHtml;
}

function startDashboardCountdown(nextEvent) {
    if (dashboardCountdownTimer) clearInterval(dashboardCountdownTimer);
    if (!nextEvent) return;

    const target = new Date(nextEvent.event_date + 'T' + nextEvent.event_time + ':00');
    // Approximate Berlin offset for countdown display
    function updateCountdown() {
        const el = document.getElementById('dashboard-countdown');
        if (!el) { clearInterval(dashboardCountdownTimer); return; }
        const now = new Date();
        // Use Berlin-aware date for countdown
        const nowBerlin = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
        const diff = target - nowBerlin;
        if (diff <= 0) {
            el.textContent = 'Jetzt!';
            clearInterval(dashboardCountdownTimer);
            return;
        }
        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        parts.push(`${hours}h ${mins}m ${secs}s`);
        el.textContent = parts.join(' ');
    }
    updateCountdown();
    dashboardCountdownTimer = setInterval(updateCountdown, 1000);
}
