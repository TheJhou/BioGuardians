#!/bin/bash
# ============================================================
# BioGuardians - Database Migration Runner
#
# Applies SQL migrations from db/migrations/ in order.
# Tracks applied migrations in a journal table with SHA-256
# checksums to detect tampering with already-applied files.
#
# Usage:
#   ./db/migrate.sh                 # apply pending migrations
#   ./db/migrate.sh --status        # show migration status
#   ./db/migrate.sh --dry-run       # show what would be applied
#
# Environment (all required except HOST and PORT):
#   POSTGRES_HOST     (default: localhost)
#   POSTGRES_PORT     (default: 5432)
#   POSTGRES_USER     (required)
#   POSTGRES_PASSWORD (required)
#   POSTGRES_DB       (required)
#   MIGRATIONS_DIR    (default: ./migrations relative to script)
# ============================================================
set -euo pipefail

# ---------- Configuration ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$SCRIPT_DIR/migrations}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"

# Credenciais são obrigatórias — sem defaults hardcoded.
: "${POSTGRES_USER:?POSTGRES_USER is required (set in .env or environment)}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required (set in .env or environment)}"
: "${POSTGRES_DB:?POSTGRES_DB is required (set in .env or environment)}"

DB_USER="$POSTGRES_USER"
DB_NAME="$POSTGRES_DB"
export PGPASSWORD="$POSTGRES_PASSWORD"

PSQL_BASE="psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME""

# ---------- Helpers ----------
log()   { echo "   $*"; }
header(){ echo "==> $*"; }
die()   { echo "ERROR: $*" >&2; exit 1; }

# Wait for database to be ready
wait_for_db() {
    header "Waiting for database at $DB_HOST:$DB_PORT..."
    for i in $(seq 1 30); do
        if $PSQL_BASE -t -A -c "SELECT 1" >/dev/null 2>&1; then
            log "Database is ready."
            return 0
        fi
        log "Attempt $i/30..."
        sleep 1
    done
    die "Could not connect to database at $DB_HOST:$DB_PORT after 30 attempts."
}

# Ensure journal table exists
ensure_journal() {
    header "Ensuring migration journal exists..."
    $PSQL_BASE <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    id           SERIAL       PRIMARY KEY,
    filename     VARCHAR(255) NOT NULL UNIQUE,
    checksum     VARCHAR(64)  NOT NULL,
    applied_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
SQL
}

# Get applied migrations as "filename|checksum" lines
get_applied() {
    $PSQL_BASE -t -A -F'|' -c \
        "SELECT filename, checksum FROM schema_migrations ORDER BY filename;"
}

# Compute SHA-256 hash of a file
file_hash() {
    sha256sum "$1" | cut -d' ' -f1
}

# ---------- Commands ----------
cmd_status() {
    wait_for_db
    ensure_journal

    header "Migration status:"
    local applied
    applied=$(get_applied)

    local total=0 pending=0 skipped=0

    for f in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
        local filename basename_fn hash existing existing_hash
        filename=$(basename "$f")
        hash=$(file_hash "$f")
        total=$((total + 1))

        existing=$(echo "$applied" | grep "^$filename|" || true)
        if [ -n "$existing" ]; then
            existing_hash=$(echo "$existing" | cut -d'|' -f2)
            if [ "$existing_hash" != "$hash" ]; then
                log "TAMPERED $filename (hash mismatch)"
            else
                log "APPLIED $filename"
            fi
            skipped=$((skipped + 1))
        else
            log "PENDING $filename"
            pending=$((pending + 1))
        fi
    done

    echo ""
    echo "   Total: $total | Applied: $skipped | Pending: $pending"
}

cmd_migrate() {
    local dry_run=false
    [ "${1:-}" = "--dry-run" ] && dry_run=true

    wait_for_db
    ensure_journal

    local applied
    applied=$(get_applied)

    local applied_count=0 skipped_count=0

    header "Processing migrations from $MIGRATIONS_DIR..."

    for f in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
        local filename hash existing existing_hash
        filename=$(basename "$f")
        hash=$(file_hash "$f")

        # Check if already applied
        existing=$(echo "$applied" | grep "^$filename|" || true)
        if [ -n "$existing" ]; then
            existing_hash=$(echo "$existing" | cut -d'|' -f2)
            if [ "$existing_hash" != "$hash" ]; then
                die "Migration $filename was modified after being applied!
     Stored hash:  $existing_hash
     Current hash: $hash"
            fi
            log "SKIP    $filename (already applied)"
            skipped_count=$((skipped_count + 1))
            continue
        fi

        if $dry_run; then
            log "DRY-RUN $filename (would apply)"
            applied_count=$((applied_count + 1))
            continue
        fi

        log "APPLY   $filename"
        # Apply migration + record journal entry in a single transaction.
        # If the SQL fails, the transaction rolls back and the journal
        # entry is NOT recorded, so the migration can be retried.
        $PSQL_BASE <<EOF
BEGIN;
\i $f
INSERT INTO schema_migrations (filename, checksum)
VALUES ('$filename', '$hash');
COMMIT;
EOF
        applied_count=$((applied_count + 1))
    done

    echo ""
    header "Migration summary:"
    log "Applied: $applied_count"
    log "Skipped: $skipped_count (already in journal)"

    if $dry_run; then
        log "(dry-run mode — no changes were made)"
    fi
    header "Done."
}

# ---------- Main ----------
case "${1:-}" in
    --status)  cmd_status ;;
    --dry-run) cmd_migrate --dry-run ;;
    *)         cmd_migrate "$@" ;;
esac
