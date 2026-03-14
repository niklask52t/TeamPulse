#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/teampulse/app"
SERVICE="teampulse"
APP_USER="teampulse"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Dieses Skript muss als root ausgeführt werden (sudo).${NC}"
    exit 1
fi

do_update() {
    echo -e "${GREEN}=== TeamPulse Update ===${NC}"
    echo ""

    # Backup DB before update
    if [ -f "$APP_DIR/teampulse.db" ]; then
        BACKUP="$APP_DIR/teampulse_backup_$(date +%Y%m%d_%H%M%S).db"
        cp "$APP_DIR/teampulse.db" "$BACKUP"
        echo -e "${GREEN}DB-Backup erstellt:${NC} $BACKUP"
    fi

    echo "Code aktualisieren..."
    sudo -u "$APP_USER" bash -c "cd $APP_DIR && git fetch origin && git checkout -B main origin/main"

    echo "Dependencies installieren..."
    sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm install --omit=dev"

    echo "Script aktualisieren..."
    cp "$APP_DIR/update.sh" /usr/local/bin/teampulse-update
    chmod +x /usr/local/bin/teampulse-update

    echo "Service neustarten..."
    systemctl restart "$SERVICE"

    echo ""
    echo -e "${GREEN}Update abgeschlossen.${NC}"
    systemctl status "$SERVICE" --no-pager -l
}

do_reset() {
    echo -e "${RED}=== TeamPulse KOMPLETT-RESET ===${NC}"
    echo ""
    echo -e "${RED}WARNUNG: Dies löscht ALLE Daten:${NC}"
    echo "  - Datenbank (alle Events, Kontakte, Umfragen, Antworten)"
    echo "  - Login-Daten (wird auf admin/admin zurückgesetzt)"
    echo "  - .env Konfiguration bleibt erhalten"
    echo ""

    read -p "Bist du sicher? Alle Daten gehen verloren! (ja/nein): " CONFIRM1
    if [ "$CONFIRM1" != "ja" ]; then
        echo "Abgebrochen."
        exit 0
    fi

    echo ""
    read -p "LETZTE WARNUNG - wirklich ALLES löschen und zurücksetzen? (JA in Großbuchstaben): " CONFIRM2
    if [ "$CONFIRM2" != "JA" ]; then
        echo "Abgebrochen."
        exit 0
    fi

    echo ""
    echo "Service stoppen..."
    systemctl stop "$SERVICE" || true

    echo "Datenbank und alle Backups löschen..."
    rm -f "$APP_DIR/teampulse.db" "$APP_DIR/teampulse.db-wal" "$APP_DIR/teampulse.db-shm"
    rm -f "$APP_DIR"/teampulse*.db "$APP_DIR"/teampulse*.db-wal "$APP_DIR"/teampulse*.db-shm

    echo "Code aktualisieren..."
    sudo -u "$APP_USER" bash -c "cd $APP_DIR && git fetch origin && git checkout -B main origin/main"

    echo "Dependencies installieren..."
    sudo -u "$APP_USER" bash -c "cd $APP_DIR && rm -rf node_modules && npm install --omit=dev"

    echo "Script aktualisieren..."
    cp "$APP_DIR/update.sh" /usr/local/bin/teampulse-update
    chmod +x /usr/local/bin/teampulse-update

    echo "Service starten (DB wird neu erstellt mit admin/admin)..."
    systemctl start "$SERVICE"

    echo ""
    echo -e "${GREEN}Reset abgeschlossen.${NC}"
    echo -e "${YELLOW}Standard-Login: admin / admin (Passwortänderung beim ersten Login erforderlich)${NC}"
    systemctl status "$SERVICE" --no-pager -l
}

case "${1:-}" in
    --reset)
        do_reset
        ;;
    ""|--update)
        do_update
        ;;
    *)
        echo "Verwendung: $0 [--update|--reset]"
        echo ""
        echo "  --update   Normales Update (Standard)"
        echo "  --reset    Komplett-Reset: löscht alle Daten und setzt alles zurück"
        exit 1
        ;;
esac
