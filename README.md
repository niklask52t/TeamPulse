# TeamPulse

WhatsApp-basiertes Anwesenheits-Management für Teams. Erstelle Trainings, Turniere und andere Events, versende automatisch Umfragen per WhatsApp (via WAHA) und sammle die Antworten übersichtlich im Dashboard.

## Features

- **Event-Management**: Wiederkehrende Trainings und einmalige Events (Turniere, Sondertermine) erstellen und verwalten
- **Kontaktverwaltung**: Telefonnummern der Teammitglieder anlegen und gruppieren
- **WhatsApp-Umfragen**: Automatische Zu-/Absage-Umfragen per WhatsApp über WAHA
- **Antwort-Sammlung**: Übersichtliche Darstellung aller Zu- und Absagen im Dashboard
- **Gruppen-Posting**: Gesammelte Ergebnisse werden zu einem konfigurierbaren Zeitpunkt in eine WhatsApp-Gruppe gepostet
- **Erinnerungen**:
  - 60 Minuten vor Ablauf der Abstimmungsfrist
  - 1 Stunde vor Event-Beginn

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla HTML/CSS/JS (leichtgewichtig, kein Build-Step)
- **Datenbank**: SQLite (via better-sqlite3)
- **WhatsApp**: WAHA (WhatsApp HTTP API)
- **Scheduler**: node-cron für zeitgesteuerte Nachrichten

## Setup

### Voraussetzungen

- Node.js >= 18
- WAHA-Instanz (läuft als Docker-Container)

### Installation

```bash
git clone https://github.com/niklask52t/TeamPulse.git
cd TeamPulse
npm install
cp .env.example .env
# .env anpassen (WAHA-URL, Gruppen-ID, etc.)
npm start
```

### Umgebungsvariablen

| Variable | Beschreibung | Beispiel |
|---|---|---|
| `PORT` | Server-Port | `3000` |
| `WAHA_API_URL` | URL der WAHA-Instanz | `http://localhost:3000` |
| `WAHA_API_KEY` | API-Key für WAHA | `your-api-key` |
| `WAHA_SESSION` | WAHA Session-Name | `default` |
| `GROUP_CHAT_ID` | WhatsApp Gruppen-ID für Ergebnis-Posts | `120363xxx@g.us` |

## Lizenz

MIT
