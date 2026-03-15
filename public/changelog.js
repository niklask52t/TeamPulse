// ===== CHANGELOG DATA =====

const CHANGELOG = [
    {
        version: '2.0.0',
        date: '2026-03-15',
        changes: [
            { type: 'feature', text: 'Dashboard-Übersicht: neuer Start-Tab mit Key-Metrics, nächstes Event mit Countdown, aktive Umfragen mit Fortschrittsbalken, Antwort-Trend der letzten 10 Umfragen' },
            { type: 'feature', text: 'Automatische Absage: optionale Mindest-Zusagen pro Event — bei zu wenigen Zusagen wird automatisch eine Absage-Nachricht in die Gruppe gesendet' },
            { type: 'feature', text: 'Wiederkehrende Ausnahmen: einzelne Termine bei wiederkehrenden Events aussetzen (z.B. Feiertage), mit optionalem Grund' },
            { type: 'feature', text: 'Kommentare für Zusagen: nach jeder Abstimmung (auch Ja) können Teilnehmer privat einen Kommentar senden (z.B. "Komme 10 Min später")' },
            { type: 'feature', text: 'Poll-Hinweis: "Privat antworten für Kommentar" wird automatisch in jeder Umfrage angezeigt' },
            { type: 'feature', text: 'Ergebnis-Post zeigt jetzt auch Kommentare von Ja-Stimmern an' },
            { type: 'feature', text: 'Event-Beschreibung: optionales Freitextfeld pro Event — wird in Umfragen, Erinnerungen, Ergebnis-Posts, Gruppenbeschreibung und Dashboard angezeigt' },
            { type: 'feature', text: 'Konfigurierbare Erinnerungen: Start-Erinnerung (Standard 60 Min vor Event), zwei Abstimmungs-Erinnerungen (Standard 120 und 15 Min vor Frist) — alles pro Event einstellbar' },
            { type: 'improvement', text: 'Start-Erinnerung zeigt Event-Namen und dynamische Zeitangabe statt "in 1 Stunde"' },
            { type: 'feature', text: 'Festes Datum für Abstimmungsfrist: alternativ zu "Stunden vor Event" kann ein konkretes Datum+Uhrzeit als Frist gewählt werden' },
            { type: 'improvement', text: 'Zeitvalidierung: Treffenszeit muss vor der Uhrzeit, Endzeit muss nach der Uhrzeit liegen' },
            { type: 'fix', text: 'Statistiken und Dashboard basieren jetzt ausschließlich auf abgeschlossenen Umfragen (nicht mehr auf aktiven)' },
            { type: 'fix', text: 'Tab-Wechsel lädt Daten jetzt immer neu — kein leerer Tab mehr nach Navigation' },
            { type: 'fix', text: 'Webhook-Fehlerbehandlung: Stimmen werden jetzt auch nach Server-Neustart zuverlässig verarbeitet (try/catch für poll.vote-Handler)' },
            { type: 'improvement', text: 'Gruppenbeschreibung: automatische Wiederholung bei WAHA-Fehler (Store-Cache-Problem nach Neustart)' },
            { type: 'feature', text: 'Manuelle Stimmkorrektur: Klick auf Mitgliedername in Umfrage-Details → Stimme ändern (✅/❌/🤷/⏳)' },
            { type: 'improvement', text: 'Gruppenbeschreibung wechselt automatisch zum nächsten Event sobald das aktuelle Event endet (end_time) bzw. beginnt (event_time falls kein Ende gesetzt)' },
        ]
    },
    {
        version: '1.10.0',
        date: '2026-03-15',
        changes: [
            { type: 'feature', text: 'Endzeit für Events: optionales "Ende"-Feld wird in Umfragen, Erinnerungen und Gruppenbeschreibung angezeigt' },
            { type: 'feature', text: 'Fester Versandzeitpunkt: alternativ zu "X Stunden vorher" kann ein konkretes Datum+Uhrzeit für den Umfrage-Versand gewählt werden' },
            { type: 'feature', text: 'Nächste 3 Events in Gruppenbeschreibung: unterhalb des aktuellen Event-Status werden die nächsten Termine aufgelistet' },
        ]
    },
    {
        version: '1.9.0',
        date: '2026-03-15',
        changes: [
            { type: 'feature', text: 'Automatische WhatsApp-Gruppenbeschreibung: zeigt nächstes Event, Status aller Mitglieder (Zusagen, Absagen mit Grund, Vielleicht mit Grund, Ausstehend) — wird bei jeder Änderung automatisch aktualisiert' },
            { type: 'feature', text: 'Neuer Tab "Beschreibung": statische Textblöcke erstellen (oberhalb/unterhalb vom Event-Status), Vorschau mit Zeichenzähler, manuelles Aktualisieren' },
            { type: 'feature', text: 'Footer in Gruppenbeschreibung: "Powered by TeamPulse by Niklas Kronig"' },
            { type: 'feature', text: 'Getrennte Debounce-Timer: 15s für Abstimmungen, 120s für Textblock-Änderungen' },
            { type: 'feature', text: '"In WhatsApp aktualisieren" Button für sofortiges Update der Gruppenbeschreibung' },
            { type: 'fix', text: 'Wiederkehrende Events am gleichen Wochentag erstellen jetzt Poll für heute statt nächste Woche' },
            { type: 'fix', text: '"Noch keine Umfragen vorhanden" wird nicht mehr angezeigt wenn ausstehende Polls existieren' },
            { type: 'fix', text: 'LID-Auflösung: unbekannte WhatsApp Linked IDs werden jetzt per WAHA-API aufgelöst und gecacht' },
        ]
    },
    {
        version: '1.8.3',
        date: '2026-03-14',
        changes: [
            { type: 'fix', text: 'Abstimmung nur noch über native WhatsApp-Umfrage (poll.vote) — Text-Nachrichten in Gruppen werden komplett ignoriert' },
            { type: 'fix', text: 'Private Nachrichten werden nur noch für Begründungen verarbeitet, nicht mehr als Stimmabgabe' },
            { type: 'delete', text: 'Text-basierte Stimmenerkennung (Keyword-Matching auf "ja", "nein" etc.) entfernt — war Ursache für falsche Follow-up-Nachrichten' },
        ]
    },
    {
        version: '1.8.2',
        date: '2026-03-14',
        changes: [
            { type: 'feature', text: 'Hilfe und Changelog als eigene Overlay-Fenster statt Footer-Panels — bessere Übersicht auf großen Bildschirmen' },
            { type: 'feature', text: 'Overlays schließen mit Escape-Taste oder Klick auf Hintergrund' },
        ]
    },
    {
        version: '1.8.1',
        date: '2026-03-14',
        changes: [
            { type: 'fix', text: 'Wiederkehrende Events erstellen jetzt sofort eine Umfrage für den nächsten Termin (statt auf Scheduler zu warten)' },
            { type: 'feature', text: 'Ausstehende Umfragen werden in eigenem ausklappbaren Bereich angezeigt (wie Archiv)' },
        ]
    },
    {
        version: '1.8.0',
        date: '2026-03-14',
        changes: [
            { type: 'feature', text: 'Umfrage-Versand konfigurierbar: neues Feld "Umfrage senden (Stunden vor Event)", Standard 24h' },
            { type: 'feature', text: 'Abstimmungsfrist und Ergebnis-Post vereint: ein Feld, Ergebnis wird sofort bei Fristablauf gepostet (Standard 1h)' },
            { type: 'feature', text: 'Treffenszeit: optionale Uhrzeit pro Event, wird in Umfrage, Erinnerungen und Ergebnis-Post angezeigt' },
            { type: 'feature', text: 'Absage-Begründung: bei "Nein"-Stimme wird privat nach dem Grund gefragt (5-Min-Fenster)' },
            { type: 'feature', text: 'DEV_MODE: Gruppen-Tab im Footer nur sichtbar wenn DEV_MODE=true in .env' },
            { type: 'feature', text: 'Hilfe-Seite komplett überarbeitet: 10 Abschnitte inkl. Konfiguration, Webhook-Setup, Fehlerbehebung' },
            { type: 'delete', text: 'Separates "Ergebnis-Post"-Feld entfernt — Ergebnis wird automatisch bei Fristablauf gepostet' },
        ]
    },
    {
        version: '1.7.6',
        date: '2026-03-14',
        changes: [
            { type: 'fix', text: 'Poll-Votes über native WhatsApp-Umfragen werden jetzt korrekt erkannt — LID-Format (@lid) wird unterstützt' },
            { type: 'fix', text: 'Neue Gruppenmitglieder können sofort abstimmen, auch wenn sie erst nach dem Senden beigetreten sind' },
            { type: 'fix', text: 'Umfrage kann nicht mehr doppelt gesendet werden (aktive/geschlossene Polls blockiert)' },
            { type: 'fix', text: 'Gruppen-IDs im Footer werden jetzt korrekt als Text angezeigt (statt [object Object])' },
        ]
    },
    {
        version: '1.7.5',
        date: '2026-03-14',
        changes: [
            { type: 'feature', text: 'Gruppen-Tab im Footer: zeigt alle WhatsApp-Gruppen mit ID und Kopieren-Button (von WAHA abgerufen)' },
            { type: 'fix', text: 'Server hört jetzt auf 0.0.0.0 statt localhost — Webhooks von externen WAHA-Instanzen funktionieren' },
            { type: 'fix', text: '"Noch keine Events erstellt" wird nicht mehr angezeigt, während das Event-Formular offen ist' },
            { type: 'fix', text: 'Events laden: Fehlerbehandlung hinzugefügt — bei API-Fehler wird jetzt eine Fehlermeldung statt leerer Liste angezeigt' },
        ]
    },
    {
        version: '1.7.4',
        date: '2026-03-14',
        changes: [
            { type: 'delete', text: 'sendButtons komplett entfernt — WhatsApp hat sendButtons für inoffizielle Clients 2024 deaktiviert, es funktioniert grundsätzlich nicht mehr' },
            { type: 'delete', text: 'detectCapabilities() entfernt — kein Startup-Check mehr nötig, immer native WA-Umfrage' },
            { type: 'fix', text: 'Haupt-Umfrage & Erinnerungen nutzen jetzt ausschließlich native WhatsApp-Umfrage (sendPoll) bzw. plain text' },
        ]
    },
    {
        version: '1.7.3',
        date: '2026-03-14',
        changes: [
            { type: 'fix', text: 'Webhook: Button-Taps wurden nie als Votes erkannt — WAHA sendet sie als message-Event mit type=buttons_response, jetzt korrekt abgefangen' },
            { type: 'fix', text: 'Webhook: Alle eingehenden Events werden jetzt geloggt (journalctl → [WEBHOOK] Zeilen)' },
            { type: 'fix', text: 'Ergebnis-Bild: Multipart/form-data statt JSON Base64 (WAHA /api/sendFile), mit JSON-Fallback' },
            { type: 'feature', text: 'Fristen überall in Stunden statt Minuten (UI: h statt min, Eingabe 24h / 1h Standard)' },
        ]
    },
    {
        version: '1.7.2',
        date: '2026-03-14',
        changes: [
            { type: 'feature', text: 'Nur noch Button-Nachricht (kein native WA-Poll mehr) — Antworten via buttons_response' },
            { type: 'feature', text: 'Archivierung auf 24h nach Event-Ende geändert (war 1h)' },
            { type: 'delete', text: 'Manuelles Löschen von Umfragen entfernt — Löschung nur via Event-Löschung (CASCADE)' },
        ]
    },
    {
        version: '1.7.1',
        date: '2026-03-14',
        changes: [
            { type: 'feature', text: 'Hauptumfrage sendet jetzt zusätzlich eine Button-Nachricht in die Gruppe (Ja/Nein/Vielleicht Tap-Buttons)' },
            { type: 'feature', text: 'Button-Antworten (buttons_response) werden im Webhook erkannt und als Stimmabgabe verarbeitet' },
            { type: 'feature', text: '"Erinnerung senden" → "⏰ Abstimmungs-Erinnerung" (an Nicht-Voter mit Frist-Hinweis)' },
            { type: 'feature', text: '"Event-Erinnerung" → "🏃 Start-Erinnerung (Zusager)" (an Ja-Voter, Event beginnt in 1h)' },
            { type: 'fix', text: 'sendResultImage: base64 als Data-URI (data:image/png;base64,...) für WAHA sendImage' },
        ]
    },
    {
        version: '1.7.0',
        date: '2026-03-14',
        changes: [
            { type: 'feature', text: 'Antworten auto-refresh alle 15 Sekunden bei offenem Poll-Detail' },
            { type: 'feature', text: 'Footer neu: dünne Leiste am Seitenende, Wiki & Changelog als ausklappbare Panels' },
            { type: 'feature', text: 'Design-Overhaul: Animationen, Glassmorphism, Glow-Effekte, Dot-Grid-Hintergrund' },
            { type: 'feature', text: 'Standard Abstimmungsfrist geändert: 120 Min → 24h (1440 Min)' },
        ]
    },
    {
        version: '1.6.0',
        date: '2026-03-14',
        changes: [
            { type: 'feature', text: 'Erinnerungen mit Tap-Buttons (Ja/Nein/Vielleicht) — Fallback auf Text wenn WAHA kein sendButtons unterstützt' },
            { type: 'feature', text: 'Ergebnis-Post sendet zusätzlich Chart-Bild in die Gruppe (PNG via @napi-rs/canvas)' },
            { type: 'feature', text: 'Abstimmungsfrist verlängern — direkt im Poll-Detail (beliebige Minuten)' },
            { type: 'feature', text: 'Statistiken-Tab: Antwortquote & Ja/Nein/Vielleicht/Offen pro Mitglied' },
        ]
    },
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
