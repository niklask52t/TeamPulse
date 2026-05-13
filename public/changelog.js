// ===== CHANGELOG DATA =====

const CHANGELOG = [
    {
        version: '2.5.27',
        date: '2026-05-14',
        changes: [
            { type: 'feature', text: 'Events haben jetzt die Option "Nächste Umfrage aussetzen": Beim Speichern wird der nächste passende Termin als einmalige Ausnahme markiert, damit genau diese Umfrage übersprungen und nicht direkt erstellt bzw. gepostet wird' },
            { type: 'improvement', text: 'Die Aussetz-Logik nutzt den bestehenden Ausnahme-Mechanismus, löscht dabei vorhandene ausstehende Polls für genau dieses Datum sauber weg und lässt spätere passende Termine normal weiterlaufen' },
        ]
    },
    {
        version: '2.5.26',
        date: '2026-05-14',
        changes: [
            { type: 'feature', text: 'Pin-Logik fuer laufende Umfragen gestrafft: Beim Start wird immer genau die aktuell relevante aktive Umfrage als einzige Pin-Kandidatin behandelt, beim Schliessen oder Wechsel wird der Pin sauber aufgeloest bzw. auf die neueste laufende Umfrage umgeschaltet' },
            { type: 'improvement', text: 'Ergebnis-Posts nehmen nicht mehr am Auto-Pin fuer aktive Umfragen teil und Event-Deaktivierung, Loeschen, Resend sowie Scheduler-Ablaeufe bereinigen den aktiven Pin-Status jetzt konsistent mit' },
        ]
    },
    {
        version: '2.5.25',
        date: '2026-05-14',
        changes: [
            { type: 'feature', text: 'Admin-Tools in Poll-Details erweitert: Status pro Person manuell setzen, Gründe direkt setzen oder ändern, Gründe löschen und Personen per PN erneut nach einem Grund fragen' },
        ]
    },
    {
        version: '2.5.24',
        date: '2026-05-13',
        changes: [
            { type: 'improvement', text: 'WhatsApp-Eventtexte trennen automatisch erzeugte Eventdaten und manuell gepflegte Beschreibung jetzt mit einer klaren Separator-Linie, damit eigene Zusatzinfos im Chat sauberer abgesetzt sind' },
        ]
    },
    {
        version: '2.5.23',
        date: '2026-05-13',
        changes: [
            { type: 'feature', text: 'Events koennen jetzt im Formular deaktiviert werden; deaktivierte Events bleiben erhalten, erzeugen keine neuen Umfragen und loeschen beim Abschalten alle noch offenen aktiven/ausstehenden Umfragen dieses Events' },
            { type: 'improvement', text: 'Event-Liste markiert deaktivierte Eintraege jetzt sichtbar und beim erneuten Aktivieren wird bei Bedarf wieder genau eine passende offene Umfrage erzeugt' },
        ]
    },
    {
        version: '2.5.22',
        date: '2026-05-13',
        changes: [
            { type: 'fix', text: 'Ausstehende Umfragen zeigen jetzt weder Noch-ausstehend noch eine Teilnehmer-Hinweisbox und blenden Tatsaechlich gesendet konsequent aus, auch wenn alte sent_at-Werte vorhanden sind' },
            { type: 'improvement', text: 'WhatsApp-Texte nutzen bei den zuletzt angefassten Follow-up- und Hinweisnachrichten wieder echte Umlaute statt ae/oe/ue und der automatische TeamPulse-Hinweis endet sauber mit dem Roboter-Emoji' },
        ]
    },
    {
        version: '2.5.21',
        date: '2026-05-13',
        changes: [
            { type: 'improvement', text: 'WhatsApp-Eventtexte weiter beruhigt: Titel bleibt wie bisher prominent, Datum/Zeit/Treffen/Info laufen jetzt einheitlich als normale Meta-Zeilen und nur der automatische TeamPulse-Hinweis bleibt dezent kursiv' },
        ]
    },
    {
        version: '2.5.20',
        date: '2026-05-13',
        changes: [
            { type: 'fix', text: 'Poll-Ablauf und Gesendet-Zeit interpretieren nackte SQLite-Zeitstempel jetzt korrekt als UTC, damit im Web keine falschen -2h-Angaben mehr auftauchen obwohl der Server schon auf CEST/Berlin laeuft' },
        ]
    },
    {
        version: '2.5.19',
        date: '2026-05-13',
        changes: [
            { type: 'fix', text: 'Evolution-LID-Zuordnung beim Gruppen-Sync und beim Live-Vote weiter gehaertet: Teilnehmer mit participant.id @lid werden jetzt direkt in contacts.lid uebernommen und notfalls beim Abstimmen erneut ueber die aktuelle Gruppenliste aufgeloest' },
        ]
    },
    {
        version: '2.5.18',
        date: '2026-05-13',
        changes: [
            { type: 'fix', text: 'Alte WhatsApp-Umfragen werden nach Reset, Loeschen oder Neuaufsetzen nicht mehr ueber den Single-Active-Poll-Fallback in eine neue aktive Umfrage hineingezogen; bei unbekannter Poll-ID wird jetzt bewusst verworfen statt geraten' },
        ]
    },
    {
        version: '2.5.17',
        date: '2026-05-13',
        changes: [
            { type: 'fix', text: 'Evolution-Webhook-Events wie messages.upsert und messages.update werden jetzt korrekt auf MESSAGES_UPSERT und MESSAGES_UPDATE normalisiert statt still ignoriert zu werden' },
        ]
    },
    {
        version: '2.5.16',
        date: '2026-05-13',
        changes: [
            { type: 'fix', text: 'Evolution-Webhook-Aliasrouten rufen den echten Handler jetzt direkt auf, statt ueber internes URL-Umschreiben zu gehen; so kommen /messages-upsert und /messages-update sicher in derselben Logik an' },
        ]
    },
    {
        version: '2.5.15',
        date: '2026-05-13',
        changes: [
            { type: 'fix', text: 'Evolution-Webhook-Aliasrouten fuer /messages-upsert und /messages-update werden jetzt direkt in den Poll-Webhook-Router durchgereicht, damit echte Poll-Votes nicht mehr still an der Alias-Weiterleitung haengen bleiben' },
        ]
    },
    {
        version: '2.5.14',
        date: '2026-05-13',
        changes: [
            { type: 'fix', text: 'Evolution-Poll-Votes werden jetzt auch dann verarbeitet, wenn der Webhook sie mit key.fromMe=true liefert, solange der echte Gruppen-Teilnehmer im participant-Feld steckt' },
        ]
    },
    {
        version: '2.5.13',
        date: '2026-05-13',
        changes: [
            { type: 'improvement', text: 'Ablaufpunkte in den Poll-Details zeigen jetzt zusaetzlich eine live aktualisierte Restzeit wie in 1h 24min oder vor 12min' },
        ]
    },
    {
        version: '2.5.12',
        date: '2026-05-13',
        changes: [
            { type: 'fix', text: 'Ausstehende Umfragen zeigen im Web keine Noch-ausstehend-Liste und keine Mitglieder mehr; die aktuelle Gruppenliste wird erst beim Aktivwerden sichtbar' },
        ]
    },
    {
        version: '2.5.11',
        date: '2026-05-13',
        changes: [
            { type: 'fix', text: 'Beim Aktivwerden und erneuten Senden einer Umfrage wird die Empfaengerliste jetzt direkt auf die aktuellen Gruppenmitglieder synchronisiert, damit Noch-ausstehend nicht auf alten Kontakten haengen bleibt' },
            { type: 'improvement', text: 'Poll-Details im Web zeigen jetzt einen Ablaufblock mit geplantem Versand, Abstimmungsfrist sowie allen Reminder-Zeitpunkten' },
        ]
    },
    {
        version: '2.5.10',
        date: '2026-05-13',
        changes: [
            { type: 'fix', text: 'Event-Formular blockiert Doppelklicks auf Speichern jetzt sauber, damit einmalige Mehrfachanlagen desselben Events nicht mehr passieren' },
            { type: 'improvement', text: 'WhatsApp-Nachrichten ruhiger neu formatiert: oben direkt der Eventname, danach Datum/Zeit/Treffen klarer gestaffelt und der automatische Hinweis dezent kursiv' },
            { type: 'fix', text: 'Evolution-Poll-Webhook verarbeitet jetzt zusaetzliche update-/messages.update-Payload-Formen robuster, damit Stimmen auch bei abweichender Evolution-Eventstruktur erkannt werden' },
            { type: 'fix', text: 'Abhaengigkeiten auf sicheren Stand gezogen: express-rate-limit, dotenv, libsql und @napi-rs/canvas aktualisiert; npm audit meldet jetzt 0 Vulnerabilities' },
        ]
    },
    {
        version: '2.5.9',
        date: '2026-05-02',
        changes: [
            { type: 'docs', text: 'README um konkreten Evolution-v2.3.7-Webhook-Workaround erweitert, falls der Manager oder der normale Set-Webhook-Body den Webhook trotz Erfolgsmeldung nicht wirklich aktiviert' },
            { type: 'docs', text: 'Webhook-Konfiguration in der Installationsanleitung auf Basis-URL plus MESSAGES_UPSERT und MESSAGES_UPDATE aktualisiert' },
        ]
    },
    {
        version: '2.5.8',
        date: '2026-05-02',
        changes: [
            { type: 'fix', text: 'Gruppenbeschreibung wieder konsequent auf 30-Sekunden-Sammelupdate gestellt, damit mehrere Stimmen gebuendelt werden und WhatsApp nicht bei jeder Einzelaktion sofort aktualisiert wird' },
            { type: 'fix', text: 'Einstellungs-Speichern zeigt Erfolg jetzt gruen statt irrtuemlich im roten Fehlerstil' },
        ]
    },
    {
        version: '2.5.7',
        date: '2026-05-02',
        changes: [
            { type: 'fix', text: 'Update-Skript nutzt jetzt npm ci statt npm install, damit package-lock.json auf dem Server bei Updates und Resets nicht dauernd lokal dirty wird' },
            { type: 'fix', text: 'Evolution-Webhooks verarbeiten jetzt neben MESSAGES_UPSERT auch MESSAGES_UPDATE robuster, damit Poll-Votes je nach Evolution-Eventform nicht mehr unter den Tisch fallen' },
            { type: 'fix', text: 'Stimmen und Begruendungen ziehen die WhatsApp-Gruppenbeschreibung jetzt sofort nach statt erst zeitverzoegert' },
        ]
    },
    {
        version: '2.5.6',
        date: '2026-05-02',
        changes: [
            { type: 'improvement', text: 'WhatsApp-Nachrichten lesbarer formatiert: weniger Vollfett, klarere Absaetze, gezieltere Hervorhebungen und ruhigere Event-/Ergebnis-Bloecke' },
        ]
    },
    {
        version: '2.5.5',
        date: '2026-05-02',
        changes: [
            { type: 'fix', text: 'Update-Skript komplett auf robustes ASCII/Bash-Handling umgestellt; keine kaputten Shell-Zeilen mehr und Update/Reset ziehen den Repo-Stand jetzt sauber hart auf origin/main' },
            { type: 'fix', text: 'Event-Formular nutzt jetzt explizite JavaScript-Validierung statt stiller Browser-Blockaden, damit Speichern in Firefox nicht mehr scheinbar kommentarlos haengen bleibt' },
            { type: 'fix', text: 'Weitere Beschreibungs-Refreshes nach Event-Loeschungen und Ausnahme-Aenderungen sofort nachgezogen, damit die WhatsApp-Gruppenbeschreibung nicht auf altem Stand kleben bleibt' },
        ]
    },
    {
        version: '2.5.4',
        date: '2026-04-30',
        changes: [
            { type: 'fix', text: 'Weitere Browser-Confirm-Stellen durch den internen Ja/Nein-Dialog ersetzt, damit Poll-, Event- und Textblock-Aktionen nicht mehr browserabhaengig wirken' },
            { type: 'fix', text: 'Gruppenbeschreibung wird bei Poll-Senden, Poll-Schliessen, Admin-Stimmaenderungen und automatischen Event-Wechseln jetzt direkt aktualisiert statt erst nach zusaetzlicher Debounce-Verzoegerung' },
        ]
    },
    {
        version: '2.5.3',
        date: '2026-04-30',
        changes: [
            { type: 'fix', text: 'Reset-Skript verwirft bei --reset jetzt zuerst lokale Repo-Aenderungen und untracked Dateien, damit der Git-Checkout nicht mehr an package-lock.json oder aehnlichen Server-Diffs haengen bleibt' },
        ]
    },
    {
        version: '2.5.2',
        date: '2026-04-30',
        changes: [
            { type: 'fix', text: 'Produktions-Session-Store von MemoryStore auf persistente SQLite/libsql-Sessions umgestellt; die Production-Warnung verschwindet und Sessions ueberleben Neustarts sauberer' },
            { type: 'feature', text: 'Event-Datumsfelder, fixe Versand-/Frist-Daten und Ausnahme-Termine nutzen jetzt einen echten Kalender-Picker mit deutscher Anzeige' },
        ]
    },
    {
        version: '2.5.1',
        date: '2026-04-30',
        changes: [
            { type: 'fix', text: 'Gruppenmitglieder aus Evolution werden jetzt auch dann korrekt synchronisiert, wenn Teilnehmer als @lid kommen und die echte Nummer in phoneNumber steckt' },
            { type: 'fix', text: 'Dashboard stoesst den Gruppen-Sync jetzt selbst an, damit Mitgliederzahlen nicht erst nach Poll-Aktionen erscheinen' },
            { type: 'improvement', text: 'Beim manuellen Schliessen einer Umfrage nutzt die UI jetzt einen eigenen Ja/Nein-Dialog statt Browser-OK/Abbrechen' },
        ]
    },
    {
        version: '2.5.0',
        date: '2026-04-30',
        changes: [
            { type: 'feature', text: 'Neuer Tab "Einstellungen": Ergebnisposts koennen jetzt global auf Nur Text, Nur Bild oder Text + Bild gestellt werden' },
            { type: 'improvement', text: 'Ergebnisbild komplett neu gestaltet: deutlich groesser, schaerfer und uebersichtlicher mit Karten, Prozenten und sauberem Layout' },
            { type: 'feature', text: 'Beim manuellen Schliessen einer Umfrage fragt die UI jetzt direkt, ob das Ergebnis sofort in die Gruppe gepostet werden soll' },
            { type: 'feature', text: 'Wiederkehrende Events erzeugen beim Schliessen sofort die naechste ausstehende Umfrage statt erst spaeter im Scheduler' },
            { type: 'improvement', text: 'Standard fuer den Umfrage-Versand auf 36 Stunden vor Event umgestellt' },
            { type: 'delete', text: 'DEV_MODE komplett entfernt, inklusive Footer-Gruppenansicht und zugehoeriger Konfig' },
        ]
    },
    {
        version: '2.4.0',
        date: '2026-04-28',
        changes: [
            { type: 'feature', text: 'WhatsApp-Provider komplett von WAHA auf Evolution API v2 umgestellt' },
            { type: 'fix', text: 'Webhook-Handling auf Evolution MESSAGES_UPSERT umgebaut; private Antworten und Poll-Votes werden ueber die neue Payload verarbeitet' },
            { type: 'fix', text: 'Gruppen, Kontakte, Gruppenmitglieder, Poll-Versand, Textnachrichten, Ergebnis-Bilder und Gruppenbeschreibung laufen jetzt ueber Evolution-Endpunkte' },
            { type: 'improvement', text: 'README komplett auf Evolution-Betrieb aktualisiert, inklusive TeamPulse-Setup und separater Debian-13-Evolution-VM' },
            { type: 'improvement', text: 'UI-Hilfe und Konfig-Hinweise auf Evolution API und den neuen Webhook-Pfad aktualisiert' },
        ]
    },
    {
        version: '2.3.0',
        date: '2026-04-20',
        changes: [
            { type: 'fix', text: 'Evolution-Aufrufe haben jetzt Timeouts, damit der Bot bei hängender Evolution-Verbindung nicht dauerhaft stehen bleibt' },
            { type: 'fix', text: 'Scheduler läuft nicht mehr parallel überlappend; lange Läufe überspringen den nächsten Tick sauber statt Aktionen doppelt auszuführen' },
            { type: 'fix', text: 'Poll-Votes werden robuster dem echten Voter und der richtigen WhatsApp-Gruppe zugeordnet' },
            { type: 'fix', text: 'Stimmen ohne eindeutige Poll-Message-ID werden nicht mehr automatisch der falschen aktiven Umfrage zugeschlagen' },
            { type: 'fix', text: 'Manuelles Ergebnisposten während aktiver Umfragen blockiert den späteren finalen Ergebnispost nicht mehr' },
            { type: 'fix', text: 'Event-Änderungen aktualisieren offene Poll-Zeitpunkte, Deadlines und Erinnerungen passend mit' },
            { type: 'improvement', text: 'UI lädt Tabs beim Start nicht mehr doppelt und öffnet Umfragen aus dem Dashboard zuverlässig' },
            { type: 'improvement', text: 'Kaputte Zeichencodierung in UI, Changelog, README und Bot-Nachrichten repariert' },
            { type: 'fix', text: 'npm-Abhängigkeiten aktualisiert; npm audit meldet keine bekannten Schwachstellen mehr' },
        ]
    },
    {
        version: '2.2.0',
        date: '2026-03-18',
        changes: [
            { type: 'fix', text: 'Umfrage-Spam behoben: In-Memory-Lock verhindert, dass der Scheduler dieselbe Umfrage mehrfach gleichzeitig versendet' },
            { type: 'improvement', text: '"Privat antworten für Kommentar" aus Umfrage-Text entfernt — Teilnehmer sehen den Kommentar-Hinweis ohnehin in der privaten Nachricht nach Abstimmung' },
            { type: 'improvement', text: 'Bot-Hinweis jetzt auch in Umfrage-Nachrichten: "🤖 Automatisch generierte Nachricht von TeamPulse" steht jetzt bei allen Bot-Aktionen in WhatsApp' },
            { type: 'feature', text: 'Kompakte Umfrage-Zusammenfassung in Gruppenbeschreibung: aktive Umfragen nach dem Haupt-Event werden als Einzeiler mit Emoji-Counts angezeigt (✅X ❌X 🤷X)' },
            { type: 'feature', text: 'Neu senden (Reset): aktive Umfragen können mit einem Klick zurückgesetzt und neu in die Gruppe gesendet werden — alle Stimmen werden gelöscht' },
            { type: 'improvement', text: 'Sortierung: aktive und ausstehende Umfragen zeigen nächstes Event oben, Archiv zeigt neustes oben' },
            { type: 'fix', text: 'SQLite-Binding-Fehler behoben: Evolution-Antworten mit unerwarteter Struktur (Objekt statt String) werden jetzt korrekt verarbeitet' },
            { type: 'fix', text: 'Stimmen-Zuordnung bei mehreren aktiven Umfragen: Stimmen werden jetzt per Poll-Message-ID der richtigen Umfrage zugeordnet (vorher immer der ersten)' },
            { type: 'improvement', text: 'Gruppenbeschreibung: kompakte Umfragen haben jetzt die Überschrift "Weitere aktive Umfragen"' },
            { type: 'improvement', text: 'Gruppenbeschreibung: Aktualisierung nur noch alle 60 Sekunden statt 15 (weniger API-Last)' },
        ]
    },
    {
        version: '2.1.0',
        date: '2026-03-17',
        changes: [
            { type: 'feature', text: 'Ja-Stimmen PN: nach Zusage wird jetzt auch eine private Nachricht mit Kommentar-Option gesendet (vorher nur bei Nein/Vielleicht)' },
            { type: 'feature', text: 'Stimmänderungs-PN: bei Ummeldung wird eine 🔄-Nachricht gesendet, die den alten Kommentar zeigt und 5 Min für einen neuen gibt' },
            { type: 'improvement', text: 'Kommentare bleiben bei Stimmänderung erhalten, wenn kein neuer Kommentar geschrieben wird — neuer Kommentar überschreibt den alten' },
            { type: 'feature', text: 'Auto-Pin: aktive Umfragen werden in der Gruppe angepinnt und beim Schließen entpinnt' },
            { type: 'feature', text: 'Auto-Pin: Ergebnis-Posts werden angepinnt und nach Event-Ende (end_time oder event_time) automatisch entpinnt' },
            { type: 'feature', text: 'Bot-Hinweis: alle automatischen Nachrichten (PNs, Ergebnisse, Absagen) enden mit "🤖 Automatisch generierte Nachricht von TeamPulse"' },
        ]
    },
    {
        version: '2.0.0',
        date: '2026-03-15',
        changes: [
            { type: 'feature', text: 'Dashboard-Übersicht: neuer Start-Tab mit Key-Metrics, nächstes Event mit Countdown, aktive Umfragen mit Fortschrittsbalken, Antwort-Trend der letzten 10 Umfragen' },
            { type: 'feature', text: 'Automatische Absage: optionale Mindest-Zusagen pro Event — bei zu wenigen Zusagen wird automatisch eine Absage-Nachricht in die Gruppe gesendet' },
            { type: 'feature', text: 'Wiederkehrende Ausnahmen: einzelne Termine bei wiederkehrenden Events aussetzen (z.B. Feiertage), mit optionalem Grund' },
            { type: 'feature', text: 'Kommentare für Zusagen: nach jeder Abstimmung (auch Ja) können Teilnehmer privat einen Kommentar senden (z.B. "Komme 10 Min später")' },
            { type: 'feature', text: 'Poll-Hinweis: Bot-Disclaimer wird automatisch in jeder Umfrage angezeigt' },
            { type: 'feature', text: 'Ergebnis-Post zeigt jetzt auch Kommentare von Ja-Stimmern an' },
            { type: 'feature', text: 'Event-Beschreibung: optionales Freitextfeld pro Event — wird in Umfragen, Erinnerungen, Ergebnis-Posts, Gruppenbeschreibung und Dashboard angezeigt' },
            { type: 'feature', text: 'Konfigurierbare Erinnerungen: Start-Erinnerung (Standard 60 Min vor Event), zwei Abstimmungs-Erinnerungen (Standard 120 und 15 Min vor Frist) — alles pro Event einstellbar' },
            { type: 'improvement', text: 'Start-Erinnerung zeigt Event-Namen und dynamische Zeitangabe statt "in 1 Stunde"' },
            { type: 'feature', text: 'Festes Datum für Abstimmungsfrist: alternativ zu "Stunden vor Event" kann ein konkretes Datum+Uhrzeit als Frist gewählt werden' },
            { type: 'improvement', text: 'Zeitvalidierung: Treffenszeit muss vor der Uhrzeit, Endzeit muss nach der Uhrzeit liegen' },
            { type: 'fix', text: 'Statistiken und Dashboard basieren jetzt ausschließlich auf abgeschlossenen Umfragen (nicht mehr auf aktiven)' },
            { type: 'fix', text: 'Tab-Wechsel lädt Daten jetzt immer neu — kein leerer Tab mehr nach Navigation' },
            { type: 'fix', text: 'Webhook-Fehlerbehandlung: Stimmen werden jetzt auch nach Server-Neustart zuverlässig verarbeitet (try/catch für poll.vote-Handler)' },
            { type: 'improvement', text: 'Gruppenbeschreibung: automatische Wiederholung bei Evolution-Fehler (Store-Cache-Problem nach Neustart)' },
            { type: 'feature', text: 'Manuelle Stimmkorrektur: Klick auf Mitgliedername in Umfrage-Details → Stimme ändern (✅/❌/🤷/⏳)' },
            { type: 'improvement', text: 'Gruppenbeschreibung wechselt automatisch zum nächsten Event sobald das aktuelle Event endet (end_time) bzw. beginnt (event_time falls kein Ende gesetzt)' },
            { type: 'feature', text: 'Zu-spät-Benachrichtigung: Wer nach Fristablauf abstimmt, bekommt eine PN dass die Abstimmung bereits beendet ist' },
            { type: 'improvement', text: 'Manuelle Stimmkorrektur jetzt auch bei archivierten Umfragen möglich — Statistiken werden korrekt aktualisiert' },
            { type: 'improvement', text: 'Ergebnis-Post zeigt jetzt auch nicht abgestimmte Mitglieder (⏳) und Total als Verhältnis (z.B. 3/5)' },
            { type: 'improvement', text: 'Abstimmungs-Erinnerung PN klar formuliert: "Du hast noch nicht abgestimmt!" statt allgemeiner Erinnerung' },
            { type: 'improvement', text: 'Dashboard Trend-Chart: Datumsangaben und Event-Titel unter den Balken, Legende für Zusagen vs. sonstige Antworten, detaillierter Tooltip' },
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
            { type: 'fix', text: 'LID-Auflösung: unbekannte WhatsApp Linked IDs werden jetzt per Evolution-API aufgelöst und gecacht' },
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
            { type: 'feature', text: 'Gruppen-Tab im Footer: zeigt alle WhatsApp-Gruppen mit ID und Kopieren-Button (von Evolution abgerufen)' },
            { type: 'fix', text: 'Server hört jetzt auf 0.0.0.0 statt localhost — Webhooks von externen Evolution-Instanzen funktionieren' },
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
            { type: 'fix', text: 'Webhook: Button-Taps wurden nie als Votes erkannt — Evolution sendet sie als message-Event mit type=buttons_response, jetzt korrekt abgefangen' },
            { type: 'fix', text: 'Webhook: Alle eingehenden Events werden jetzt geloggt (journalctl → [WEBHOOK] Zeilen)' },
            { type: 'fix', text: 'Ergebnis-Bild: Multipart/form-data statt JSON Base64 (Evolution /api/sendFile), mit JSON-Fallback' },
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
            { type: 'fix', text: 'sendResultImage: base64 als Data-URI (data:image/png;base64,...) für Evolution sendImage' },
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
            { type: 'feature', text: 'Erinnerungen mit Tap-Buttons (Ja/Nein/Vielleicht) — Fallback auf Text wenn Evolution kein sendButtons unterstützt' },
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
            { type: 'feature', text: 'Teilnehmer automatisch aus Evolution-Gruppe synchronisiert' },
            { type: 'feature', text: 'Manuelle Funktion "Umfrage schließen"' },
            { type: 'feature', text: 'Ergebnis posten schließt Umfrage NICHT mehr — mehrfach möglich' },
            { type: 'feature', text: 'Erinnerung zeigt jetzt genaue Uhrzeit der Abstimmungsfrist' },
            { type: 'fix', text: 'Poll-Votes aus Gruppe wurden nicht aufgezeichnet (payload.sender)' },
            { type: 'fix', text: 'Footer jetzt immer am Seitenende' },
            { type: 'delete', text: 'Kontakte-Tab entfernt — Teilnehmer kommen aus der Evolution-Gruppe' },
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
            { type: 'fix', text: 'Evolution Webhook-Route wurde nie erreicht (kritischer Routing-Bug)' },
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
            { type: 'feature', text: 'Automatische WhatsApp-Umfragen via Evolution' },
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
