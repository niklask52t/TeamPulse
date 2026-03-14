// ===== CHANGELOG DATA =====

const CHANGELOG = [
    {
        version: '1.5.0',
        date: '2026-03-14',
        changes: [
            { type: 'feature', text: '"Vielleicht"-Stimmen: automatische Privat-Nachricht zur Begründung' },
            { type: 'feature', text: 'Begründung von "Vielleicht"-Stimmern wird in der Übersicht angezeigt' },
            { type: 'feature', text: 'Umfrage-Antworten gruppiert nach Ja/Nein/Vielleicht/Offen' },
            { type: 'feature', text: 'Frontend in modulare Dateien aufgeteilt (app.js, events.js, polls.js, changelog.js)' },
        ]
    },
    {
        version: '1.4.0',
        date: '2026-03-14',
        changes: [
            { type: 'feature', text: 'Umfrage wird in die Gruppe geschickt (statt Einzelnachrichten)' },
            { type: 'feature', text: 'Teilnehmer automatisch aus WAHA-Gruppe synchronisiert' },
            { type: 'feature', text: 'Manuelle Funktion "Umfrage schließen"' },
            { type: 'feature', text: 'Ergebnis posten schließt Umfrage NICHT mehr — mehrfach möglich' },
            { type: 'feature', text: 'Erinnerung zeigt jetzt genaue Uhrzeit der Abstimmungsfrist' },
            { type: 'fix', text: 'Poll-Votes aus Gruppe wurden nicht aufgezeichnet (payload.sender)' },
            { type: 'fix', text: 'Footer jetzt immer am Seitenende' },
            { type: 'delete', text: 'Kontakte-Tab entfernt — Teilnehmer kommen aus der WAHA-Gruppe' },
        ]
    },
    {
        version: '1.3.0',
        date: '2026-03-13',
        changes: [
            { type: 'feature', text: 'Logo und neues Design (blau-grün Farbschema passend zum Logo)' },
            { type: 'feature', text: 'Sticky Header mit Logo' },
            { type: 'feature', text: 'Kalender-Datumskarten bei Events und Umfragen' },
            { type: 'feature', text: 'Wiki und Changelog im Footer statt als Tabs' },
            { type: 'fix', text: 'WAHA Webhook-Route wurde nie erreicht (kritischer Routing-Bug)' },
            { type: 'fix', text: 'Antwort-Erkennung: Einzelbuchstaben "n"/"j" matchten fälschlicherweise' },
        ]
    },
    {
        version: '1.2.0',
        date: '2026-03-13',
        changes: [
            { type: 'feature', text: 'Native WhatsApp-Umfragen (Tap-to-Vote)' },
            { type: 'feature', text: 'Umfragen-Archiv (automatisch 1h nach Event-Ende)' },
            { type: 'feature', text: 'Umfragen manuell löschen' },
            { type: 'feature', text: 'Manuelle Aktionsbuttons (senden, Erinnerung, Gruppen-Post, Event-Erinnerung)' },
            { type: 'feature', text: 'Live-Uhr, Wiki, Changelog, Tab-Persistenz, Dirty-Warning' },
            { type: 'fix', text: 'Event löschen, sofortiges Schließen, Ergebnis-Timing, diverse Fixes' },
        ]
    },
    {
        version: '1.1.0',
        date: '2026-03-13',
        changes: [
            { type: 'feature', text: 'Login-System mit Passwort-Pflichtänderung beim ersten Login' },
            { type: 'fix', text: 'Umlaute korrekt (ä, ö, ü, ß)' },
        ]
    },
    {
        version: '1.0.0',
        date: '2026-03-13',
        changes: [
            { type: 'feature', text: 'Events erstellen (einmalig & wiederkehrend)' },
            { type: 'feature', text: 'Automatische WhatsApp-Umfragen via WAHA' },
            { type: 'feature', text: 'Antwort-Erkennung, Gruppen-Post, Erinnerungen, Update-Script' },
        ]
    }
];

// ===== RENDER =====

function renderChangelog() {
    const list = document.getElementById('changelog-list');
    if (!list) return;

    const typeColors = {
        feature: { bg: '#23863633', color: '#3fb950', label: 'Feature' },
        fix:     { bg: '#d2992233', color: '#e3b341', label: 'Fix' },
        delete:  { bg: '#da363333', color: '#f85149', label: 'Entfernt' },
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
