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
    echo -e "${RED}Dieses Skript muss als root ausgefuehrt werden (sudo).${NC}"
    exit 1
fi

reset_repo_to_origin_main() {
    sudo -u "$APP_USER" bash -lc "
        cd '$APP_DIR'
        git fetch origin
        git reset --hard origin/main
        git clean -fd
        git checkout -B main origin/main
    "
}

do_update() {
    echo -e "${GREEN}=== TeamPulse Update ===${NC}"
    echo ""

    if [ -f "$APP_DIR/teampulse.db" ]; then
        BACKUP="$APP_DIR/teampulse_backup_$(date +%Y%m%d_%H%M%S).db"
        cp "$APP_DIR/teampulse.db" "$BACKUP"
        echo -e "${GREEN}DB-Backup erstellt:${NC} $BACKUP"
    fi

    echo "Code aktualisieren..."
    reset_repo_to_origin_main

    echo "Dependencies installieren..."
    sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm ci --omit=dev"

    echo "Script aktualisieren..."
    install -m 755 "$APP_DIR/update.sh" /usr/local/bin/teampulse-update

    echo "Service neustarten..."
    systemctl restart "$SERVICE"

    echo ""
    echo -e "${GREEN}Update abgeschlossen.${NC}"
    systemctl status "$SERVICE" --no-pager -l
}

do_reset() {
    echo -e "${RED}=== TeamPulse KOMPLETT-RESET ===${NC}"
    echo ""
    echo -e "${RED}WARNUNG: Dies loescht ALLE Daten:${NC}"
    echo "  - Datenbank (alle Events, Kontakte, Umfragen, Antworten)"
    echo "  - Login-Daten (wird auf admin/admin zurueckgesetzt)"
    echo "  - .env Konfiguration bleibt erhalten"
    echo ""

    read -r -p "Bist du sicher? Alle Daten gehen verloren! (ja/nein): " CONFIRM1
    if [ "$CONFIRM1" != "ja" ]; then
        echo "Abgebrochen."
        exit 0
    fi

    echo ""
    read -r -p "LETZTE WARNUNG - wirklich ALLES loeschen und zuruecksetzen? (JA in Grossbuchstaben): " CONFIRM2
    if [ "$CONFIRM2" != "JA" ]; then
        echo "Abgebrochen."
        exit 0
    fi

    echo ""
    echo "Service stoppen..."
    systemctl stop "$SERVICE" || true

    echo "Datenbank und alle Backups loeschen..."
    rm -f "$APP_DIR/teampulse.db" "$APP_DIR/teampulse.db-wal" "$APP_DIR/teampulse.db-shm"
    rm -f "$APP_DIR"/teampulse*.db "$APP_DIR"/teampulse*.db-wal "$APP_DIR"/teampulse*.db-shm

    echo "Code aktualisieren..."
    reset_repo_to_origin_main

    echo "Dependencies installieren..."
    sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && rm -rf node_modules && npm ci --omit=dev"

    echo "Script aktualisieren..."
    install -m 755 "$APP_DIR/update.sh" /usr/local/bin/teampulse-update

    echo "Service starten (DB wird neu erstellt mit admin/admin)..."
    systemctl start "$SERVICE"

    echo ""
    echo -e "${GREEN}Reset abgeschlossen.${NC}"
    echo -e "${YELLOW}Standard-Login: admin / admin (Passwortaenderung beim ersten Login erforderlich)${NC}"
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
        echo "  --reset    Komplett-Reset: loescht alle Daten und setzt alles zurueck"
        exit 1
        ;;
esac
