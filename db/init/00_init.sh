#!/bin/bash
# ============================================================
# BioGuardians - Inicialização do banco
# Executado automaticamente pelo entrypoint do postgres na
# 1ª inicialização do container (volume persistente vazio).
# Roda os scripts de schema e depois o seed, em ordem alfabética.
# ============================================================
set -e

run_sql() {
    psql -v ON_ERROR_STOP=1 \
        --username "$POSTGRES_USER" \
        --dbname "$POSTGRES_DB" \
        -f "$1"
}

echo "==> BioGuardians: criando schema..."
for f in /db/schema/*.sql; do
    echo "    -> $(basename "$f")"
    run_sql "$f"
done

echo "==> BioGuardians: carregando seed..."
for f in /db/seed/*.sql; do
    echo "    -> $(basename "$f")"
    run_sql "$f"
done

echo "==> BioGuardians: banco pronto para uso."
