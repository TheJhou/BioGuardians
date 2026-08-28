# BioGuardians — Project Info

## Stack
- **Database**: PostgreSQL 16 + PostGIS 3.4
- **Backend**: Node.js + Express (próxima etapa)
- **Frontend**: React + Vite + Google Maps (próxima etapa)
- **Infra**: Docker Compose ou instalação nativa (Oracle Cloud VM)
- **CI/CD**: GitHub Actions (migrations + smoke tests)

## Migrations
- Sistema customizado em `db/migrate.sh` (sem ferramentas de terceiros)
- Arquivos SQL em `db/migrations/` (numerados, aplicados em ordem)
- Journal table: `schema_migrations` (filename + checksum SHA-256)
- Cada migration roda em transação atômica
- Idempotente: rodar de novo pula o já aplicado
- Hash detecta adulteração de migrations já aplicadas
- Comandos: `sh db/migrate.sh`, `--status`, `--dry-run`

## Comandos úteis
- Subir banco (Docker): `docker compose up -d db`
- Aplicar migrations (Docker): `docker compose run --rm migrate`
- Aplicar migrations (nativo): `sh db/migrate.sh`
- Status das migrations: `sh db/migrate.sh --status`
- Smoke tests: `psql -f db/tests/smoke_test.sql` (credenciais via .env)
- Resetar banco: `docker compose down -v && docker compose up -d db && docker compose run --rm migrate`
- Conectar: `psql -d $POSTGRES_DB -U $POSTGRES_USER`
- Refresh views: `SELECT refresh_dashboard();`

## Estrutura do banco (migrations)
1. `001_extensions.sql` — PostGIS, pgcrypto
2. `002_enums_domains.sql` — enums (categoria_ameaca, esfera, etc.) e domínios
3. `003_tables.sql` — tabelas em 3FN com constraints e FKs
4. `004_indexes.sql` — GIST (espaciais) + B-tree (filtros)
5. `005_functions.sql` — funções PL/pgSQL e SQL (consultas espaciais, refresh)
6. `006_triggers.sql` — auditoria, validação de geometria, timestamps
7. `007_materialized_views.sql` — dashboard_stats, especies_por_uc, rankings
8. `008_seed_data.sql` — dados sintéticos (13 espécies, 9 UCs, 21 ocorrências)

## Decisões de modelagem
- SRID 4326 (WGS84) para todas as geometrias
- `nome_cientifico` em domínio próprio (lowercase, trim)
- UF em domínio `CHAR(2)` maiúsculo
- Taxonomia hierárquica com auto-referência (reino → gênero)
- Auditoria via trigger genérico (to_jsonb do registro inteiro)
- Views materializadas com refresh simples (não CONCURRENTLY dentro de função)
