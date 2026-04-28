# TeamPulse

TeamPulse ist ein WhatsApp-basiertes Anwesenheits-Management fuer Teams. Das Projekt nutzt jetzt **Evolution API v2** als WhatsApp-Provider und versendet native WhatsApp-Umfragen direkt in eine konfigurierte Gruppe.

## Features

- geschuetztes Dashboard mit Login und Passwortwechsel beim ersten Start
- einmalige und wiederkehrende Events
- automatische native WhatsApp-Polls in der Gruppe
- private Follow-up-Nachrichten nach `Ja`, `Nein` und `Vielleicht`
- Kommentare/Gruende innerhalb von 5 Minuten
- automatische Erinnerungen und Event-Reminder
- Ergebnis-Post als Text plus Chart-Bild
- automatische Gruppenbeschreibung
- DEV-Gruppenuebersicht zum Nachschlagen der `GROUP_CHAT_ID`

## Stack

- Backend: Node.js 24 + Express 5
- Frontend: Vanilla HTML/CSS/JS
- Datenbank: SQLite via `libsql`
- Scheduler: `node-cron`
- WhatsApp: Evolution API v2

## Standard-Login

| Benutzer | Passwort |
|---|---|
| `admin` | `admin` |

Beim ersten Login muss das Passwort geaendert werden.

## Wichtige Umgebungsvariablen

| Variable | Bedeutung | Beispiel |
|---|---|---|
| `PORT` | HTTP-Port von TeamPulse | `3000` |
| `SESSION_SECRET` | zufaelliger Secret-String fuer Sessions | `change-me` |
| `EVOLUTION_API_URL` | Basis-URL der Evolution API | `http://10.0.0.20:8080` |
| `EVOLUTION_API_KEY` | globaler API-Key der Evolution API | `replace-me` |
| `EVOLUTION_INSTANCE` | Name der WhatsApp-Instanz in Evolution | `teampulse` |
| `EVOLUTION_TIMEOUT_MS` | Timeout fuer Provider-Requests | `20000` |
| `GROUP_CHAT_ID` | WhatsApp-Gruppen-JID | `120363xxxx@g.us` |
| `DEV_MODE` | Gruppen-Tab im Footer anzeigen | `false` |

## Lokale Entwicklung

```bash
git clone https://github.com/niklask52t/TeamPulse.git
cd TeamPulse
npm install
cp .env.example .env
npm run dev
```

## TeamPulse auf Debian 13 installieren

### 1. System vorbereiten

```bash
apt update && apt upgrade -y
apt install -y curl git ca-certificates build-essential python3
```

### 2. Node.js 24 installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node -v
```

### 3. Systembenutzer anlegen

```bash
useradd -r -m -s /bin/bash teampulse
```

### 4. Repo klonen

```bash
sudo -u teampulse bash -c '
  cd /home/teampulse
  git clone https://github.com/niklask52t/TeamPulse.git app
  cd app
  npm install --omit=dev
  cp .env.example .env
'
```

### 5. `.env` anpassen

```bash
sudo -u teampulse nano /home/teampulse/app/.env
```

Beispiel:

```ini
PORT=3000
SESSION_SECRET=HIER_EINEN_LANGEN_ZUFAELLIGEN_STRING
EVOLUTION_API_URL=http://EVOLUTION-VM:8080
EVOLUTION_API_KEY=DEIN_EVOLUTION_API_KEY
EVOLUTION_INSTANCE=teampulse
EVOLUTION_TIMEOUT_MS=20000
GROUP_CHAT_ID=120363xxxxxxxx@g.us
DEV_MODE=false
```

`SESSION_SECRET` kannst du so erzeugen:

```bash
openssl rand -hex 32
```

### 6. Starttest

```bash
sudo -u teampulse bash -c 'cd /home/teampulse/app && node server.js'
```

Erwartet:

```text
TeamPulse running on http://0.0.0.0:3000
```

### 7. Systemd-Service anlegen

```bash
cat >/etc/systemd/system/teampulse.service <<'EOF'
[Unit]
Description=TeamPulse
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

### 8. Aktivieren und starten

```bash
systemctl daemon-reload
systemctl enable teampulse
systemctl start teampulse
systemctl status teampulse
journalctl -u teampulse -f
```

### 9. Firewall

```bash
apt install -y ufw
ufw allow ssh
ufw allow 3000/tcp
ufw enable
```

## Evolution API auf separater Debian-13-VM

Das ist die empfohlene Variante.

### 1. VM vorbereiten

```bash
apt update && apt upgrade -y
apt install -y curl ca-certificates gnupg2 lsb-release ufw
```

### 2. Docker + Compose Plugin installieren

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version
docker compose version
```

### 3. Arbeitsverzeichnis anlegen

```bash
mkdir -p /opt/evolution-api
cd /opt/evolution-api
```

### 4. `.env` fuer Evolution anlegen

```bash
nano .env
```

Beispiel:

```ini
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=http://YOUR-EVOLUTION-VM:8080

AUTHENTICATION_API_KEY=replace-with-a-random-secret

DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:evolutionpass@postgres:5432/evolution
DATABASE_CONNECTION_CLIENT_NAME=teampulse

DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
DATABASE_SAVE_DATA_LABELS=true
DATABASE_SAVE_DATA_HISTORIC=true

CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://redis:6379/6
CACHE_REDIS_PREFIX_KEY=evolution
CACHE_REDIS_SAVE_INSTANCES=false
CACHE_LOCAL_ENABLED=false

WEBSOCKET_ENABLED=false
TELEMETRY=false
```

### 5. `docker-compose.yml` anlegen

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: evolutionpass
      POSTGRES_DB: evolution
    volumes:
      - evolution_postgres:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - evolution_redis:/data

  evolution-api:
    image: evoapicloud/evolution-api:v2.3.7
    container_name: evolution_api
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "8080:8080"
    volumes:
      - evolution_instances:/evolution/instances
    depends_on:
      - postgres
      - redis

volumes:
  evolution_postgres:
  evolution_redis:
  evolution_instances:
```

Wenn eine neuere stabile Evolution-v2-Version verfuegbar ist, ersetze `v2.3.7` durch einen konkreten neuen Tag.

### 6. Evolution starten

```bash
docker compose up -d
docker compose logs -f evolution-api
```

### 7. Firewall auf der Evolution-VM

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow from APP_SERVER_IP to any port 8080 proto tcp
ufw enable
```

### 8. Evolution Manager oeffnen

Im Browser:

- `http://YOUR-EVOLUTION-VM:8080/manager`

Login mit:

- `AUTHENTICATION_API_KEY`

### 9. Instanz in Evolution anlegen

Im Manager:

1. neue Instanz erstellen, z. B. `teampulse`
2. `Baileys` als Channel waehlen
3. WhatsApp-Nummer im internationalen Format ohne `+` eintragen
4. speichern
5. QR-Code scannen

Der Instanzname muss exakt mit `EVOLUTION_INSTANCE` in TeamPulse uebereinstimmen.

### 10. Webhook in Evolution konfigurieren

Im Evolution Manager fuer die TeamPulse-Instanz:

- URL: `http://YOUR-TEAMPULSE-IP:3000/api/webhooks/evolution/messages-upsert`
- Webhook by Events: `enabled`
- Base64: `disabled`
- Event: `MESSAGES_UPSERT`

### 11. Gruppen-ID finden

Im Evolution Manager die Gruppenliste der verbundenen Instanz oeffnen und die Zielgruppe kopieren.

Format:

```text
120363xxxxxxxx@g.us
```

Diesen Wert in TeamPulse als `GROUP_CHAT_ID` eintragen.

### 12. TeamPulse mit Evolution verbinden

In `/home/teampulse/app/.env`:

```ini
EVOLUTION_API_URL=http://YOUR-EVOLUTION-VM:8080
EVOLUTION_API_KEY=YOUR_API_KEY
EVOLUTION_INSTANCE=teampulse
GROUP_CHAT_ID=120363xxxxxxxx@g.us
```

Danach TeamPulse neu starten:

```bash
systemctl restart teampulse
journalctl -u teampulse -f
```

## Hinweise

- TeamPulse nutzt jetzt nur noch Evolution API. WAHA wird nicht mehr benoetigt.
- Ergebnis-Bilder laufen ueber `sendMedia` der Evolution API.
- Gruppenbeschreibung, Polls, private Erinnerungen und Ergebnis-Posts laufen ueber dieselbe Evolution-Instanz.
- Das aktuelle TeamPulse-Verhalten bleibt auf Text + Bild fuer Ergebnis-Posts ausgelegt.
- Message Pinning/Unpinning haengt von der verfuegbaren Evolution-API-Unterstuetzung ab. Die offiziellen v2-Dokumentationsseiten zeigen dafuer derzeit keinen separaten Endpunkt.

## Lizenz

MIT

---
Last reviewed: 2026-04-28
