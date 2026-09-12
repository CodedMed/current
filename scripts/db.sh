#!/usr/bin/env bash
# Local Tiger Data / TimescaleDB for development.
#
# Wraps the `db` service in docker-compose.dev.yml so the ledger service can run against a real,
# persistent PostgreSQL with the timescaledb extension instead of the throwaway embedded database.
# Nothing here is needed for the no-infrastructure demo path; see README "About the database".
#
#   scripts/db.sh up        start TimescaleDB (idempotent) and print the DATABASE_URL to export
#   scripts/db.sh status    what is live: extension, hypertable, aggregate, policies, /health
#   scripts/db.sh psql      open psql inside the container (extra args are passed through)
#   scripts/db.sh reset     drop the data volume and start fresh; the next service boot re-migrates
#                           and re-seeds the demo business
#   scripts/db.sh down      stop the container, keep the data
#   scripts/db.sh url       print the connection string only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/docker-compose.dev.yml")
DATABASE_URL="postgresql://copilot:copilot@localhost:5432/copilot"
LEDGER_URL="${LEDGER_SERVICE_URL:-http://localhost:8080}"

require_docker() {
    if ! docker info >/dev/null 2>&1; then
        echo "Docker is not running. Start Docker Desktop and try again." >&2
        exit 1
    fi
}

psql_in_container() {
    "${COMPOSE[@]}" exec -T db psql -U copilot -d copilot -v ON_ERROR_STOP=1 "$@"
}

data_volume() {
    # The volume name carries the compose project prefix, so read it off the container rather
    # than guessing it.
    local cid
    cid="$("${COMPOSE[@]}" ps -aq db 2>/dev/null || true)"
    if [ -n "$cid" ]; then
        docker inspect "$cid" \
            --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}'
    else
        docker volume ls -q --filter label=com.docker.compose.volume=copilot-db | head -n 1
    fi
}

case "${1:-help}" in
    up)
        require_docker
        "${COMPOSE[@]}" up -d --wait db
        echo
        echo "TimescaleDB is ready. Run the ledger service against it with:"
        echo
        echo "  export DATABASE_URL=$DATABASE_URL"
        echo "  cd services/ledger-service && ./mvnw spring-boot:run"
        ;;
    down)
        require_docker
        "${COMPOSE[@]}" stop db
        ;;
    reset)
        require_docker
        volume="$(data_volume)"
        "${COMPOSE[@]}" rm -sf db >/dev/null
        if [ -n "$volume" ]; then
            docker volume rm "$volume" >/dev/null
            echo "Removed data volume $volume."
        fi
        "${COMPOSE[@]}" up -d --wait db
        echo "Fresh TimescaleDB. The next ledger-service boot re-runs every migration and re-seeds."
        ;;
    psql)
        require_docker
        shift
        "${COMPOSE[@]}" exec db psql -U copilot -d copilot "$@"
        ;;
    status)
        require_docker
        echo "== database =="
        psql_in_container -Atc "
            SELECT 'server:        ' || split_part(version(), ',', 1);
            SELECT 'timescaledb:   ' || COALESCE((SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'), 'NOT INSTALLED');
            SELECT 'migrations:    ' || string_agg(version, ', ' ORDER BY installed_rank) FROM flyway_schema_history WHERE success;
            SELECT 'hypertables:   ' || COALESCE(string_agg(hypertable_name || ' (' || num_chunks || ' chunks)', ', '), 'none') FROM timescaledb_information.hypertables;
            SELECT 'aggregates:    ' || COALESCE(string_agg(view_name, ', '), 'none') FROM timescaledb_information.continuous_aggregates;
            SELECT 'policies:      ' || COALESCE(string_agg(proc_name || ' on ' || hypertable_name, ', '), 'none') FROM timescaledb_information.jobs WHERE hypertable_name IS NOT NULL;
            SELECT 'cash_events:   ' || COUNT(*) || ' rows' FROM cash_events;
        " 2>/dev/null || echo "(schema not migrated yet — start the ledger service once)"
        echo
        echo "== ledger service ($LEDGER_URL/health) =="
        if curl -sf "$LEDGER_URL/health" >/dev/null 2>&1; then
            curl -s "$LEDGER_URL/health" | python3 -c 'import json,sys; [print(f"{k:<24}{v}") for k,v in json.load(sys.stdin)["database"].items()]'
        else
            echo "not running"
        fi
        ;;
    url)
        echo "$DATABASE_URL"
        ;;
    *)
        sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
