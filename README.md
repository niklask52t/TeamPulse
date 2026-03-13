# TeamPulse

WhatsApp-basiertes Anwesenheits-Management für Teams. Erstelle Trainings, Turniere und andere Events, versende automatisch Umfragen per WhatsApp (via WAHA) und sammle die Antworten übersichtlich im Dashboard.

## Features

- **Login-System**: Geschütztes Dashboard mit Passwort-Pflichtänderung beim ersten Login
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
- **Datenbank**: SQLite (via libsql)
- **WhatsApp**: WAHA (WhatsApp HTTP API)
- **Scheduler**: node-cron für zeitgesteuerte Nachrichten
- **Auth**: bcrypt + express-session

## Standard-Login

| Benutzer | Passwort |
|----------|----------|
| `admin`  | `admin`  |

> Beim ersten Login **muss** das Passwort geändert werden. Der Benutzername kann optional angepasst werden.

## Umgebungsvariablen

| Variable | Beschreibung | Beispiel |
|---|---|---|
| `PORT` | Server-Port | `3000` |
| `SESSION_SECRET` | Session-Verschlüsselung (zufälliger String) | `a1b2c3d4e5...` |
| `WAHA_API_URL` | URL der WAHA-Instanz | `http://localhost:3000` |
| `WAHA_API_KEY` | API-Key für WAHA | `your-api-key` |
| `WAHA_SESSION` | WAHA Session-Name | `default` |
| `GROUP_CHAT_ID` | WhatsApp Gruppen-ID für Ergebnis-Posts | `120363xxx@g.us` |

---

## Produktiv-Installation auf Debian 13 (Trixie)

Komplette Schritt-für-Schritt-Anleitung für eine produktive Installation mit Autostart.

### 1. System vorbereiten

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential python3
```

### 2. Node.js 24 LTS installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v  # sollte v24.x zeigen
```

### 3. Systembenutzer anlegen

```bash
sudo useradd -r -m -s /bin/bash teampulse
```

### 4. Git-Credentials speichern

Damit beim `git pull` nicht jedes Mal Benutzername und Passwort (bzw. Token) abgefragt werden:

```bash
# Credentials dauerhaft auf dem Server speichern
sudo -u teampulse git config --global credential.helper store
```

> Beim ersten `git clone` oder `git pull` werden die Zugangsdaten abgefragt und danach in `~/.git-credentials` gespeichert. Für private Repos einen **Personal Access Token** (PAT) statt Passwort verwenden:
>
> GitHub -> Settings -> Developer settings -> Personal access tokens -> Tokens (classic) -> Generate new token (Scope: `repo`)
>
> Beim Login dann den Token als Passwort eingeben.

### 5. TeamPulse klonen und installieren

```bash
sudo -u teampulse bash -c '
  cd /home/teampulse
  git clone https://github.com/niklask52t/TeamPulse.git app
  cd app
  npm install --omit=dev
  cp .env.example .env
'
```

### 6. Konfiguration anpassen

```bash
sudo -u teampulse nano /home/teampulse/app/.env
```

Inhalt:

```env
PORT=3000
SESSION_SECRET=HIER_EINEN_LANGEN_ZUFAELLIGEN_STRING_EINSETZEN
WAHA_API_URL=http://localhost:3000
WAHA_API_KEY=dein-waha-api-key
WAHA_SESSION=default
GROUP_CHAT_ID=120363xxx@g.us
```

> **Tipp:** WAHA_API_URL muss auf die WAHA-Docker-Instanz zeigen, z.B. `http://localhost:3000` wenn WAHA auf dem gleichen Server läuft. Der TeamPulse-Port muss anders sein (z.B. 8080).

#### SESSION_SECRET generieren

Einfach einen der folgenden Befehle ausführen und den Output in die `.env` kopieren:

```bash
# Option 1 – openssl (empfohlen)
openssl rand -hex 32

# Option 2 – Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Direkt in die .env schreiben (ersetzt den Platzhalter):
sed -i "s/HIER_EINEN_LANGEN_ZUFAELLIGEN_STRING_EINSETZEN/$(openssl rand -hex 32)/" /home/teampulse/app/.env
```

### 7. Kurzer Test

```bash
sudo -u teampulse bash -c 'cd /home/teampulse/app && node server.js'
# Sollte "TeamPulse running on http://localhost:3000" ausgeben
# Mit Ctrl+C beenden
```

### 8. Systemd-Service erstellen

```bash
sudo tee /etc/systemd/system/teampulse.service > /dev/null << 'EOF'
[Unit]
Description=TeamPulse - WhatsApp Attendance Manager
After=network.target

[Service]
Type=simple
User=teampulse
Group=teampulse
WorkingDirectory=/home/teampulse/app
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
```

### 9. Service aktivieren und starten

```bash
sudo systemctl daemon-reload
sudo systemctl enable teampulse
sudo systemctl start teampulse
```

### 10. Status prüfen

```bash
sudo systemctl status teampulse
# Logs anschauen:
sudo journalctl -u teampulse -f
```

### 11. WAHA einrichten (Docker)

Falls WAHA noch nicht läuft:

```bash
sudo apt install -y docker.io
sudo systemctl enable docker

sudo docker run -d \
  --name waha \
  --restart always \
  -p 3001:3000 \
  -v waha_data:/app/store \
  devlikeapro/waha:latest
```

> In diesem Beispiel läuft WAHA auf Port 3001. Passe `WAHA_API_URL=http://localhost:3001` in der `.env` an.

Nach dem Start WAHA im Browser öffnen (`http://DEIN_SERVER:3001`) und eine WhatsApp-Session per QR-Code verbinden.

### 12. WAHA Webhook konfigurieren

In WAHA muss ein Webhook eingerichtet werden, damit eingehende Nachrichten an TeamPulse weitergeleitet werden:

```bash
curl -X POST http://localhost:3001/api/sessions/default/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:3000/api/webhooks/waha",
    "events": ["message"]
  }'
```

### 13. Firewall (optional)

```bash
sudo apt install -y ufw
sudo ufw allow ssh
sudo ufw allow 3000/tcp   # TeamPulse
sudo ufw allow 3001/tcp   # WAHA (nur wenn remote nötig)
sudo ufw enable
```

### 14. Update-Skript installieren

```bash
sudo cp /home/teampulse/app/update.sh /usr/local/bin/teampulse-update
sudo chmod +x /usr/local/bin/teampulse-update
```

### Updates einspielen

```bash
# Normales Update (Code + Dependencies)
sudo teampulse-update

# Komplett-Reset (loescht DB + alle Daten, mit doppelter Bestaetigung)
sudo teampulse-update --reset
```

### Logs & Troubleshooting

```bash
# Live-Logs
sudo journalctl -u teampulse -f

# Service neustarten
sudo systemctl restart teampulse

# DB-Backup
sudo cp /home/teampulse/app/teampulse.db /home/teampulse/backup_$(date +%Y%m%d).db

# Passwort zurücksetzen (Notfall)
sudo -u teampulse bash -c '
  cd /home/teampulse/app
  node -e "
    const db = require(\"./db/database\");
    const bcrypt = require(\"bcrypt\");
    const hash = bcrypt.hashSync(\"admin\", 10);
    db.prepare(\"UPDATE users SET password_hash = ?, must_change_password = 1 WHERE username = ?\").run(hash, \"admin\");
    console.log(\"Passwort zurückgesetzt auf admin/admin\");
  "
'
```

---

## Lokale Entwicklung

```bash
git clone https://github.com/niklask52t/TeamPulse.git
cd TeamPulse
npm install
cp .env.example .env
npm run dev
```

## Lizenz

MIT
