# BioGuardians — Project Info

## Stack
- **Database**: PostgreSQL 16 + PostGIS 3.4
- **Backend**: Node.js + Express (próxima etapa)
- **Frontend**: React + Vite + Google Maps (próxima etapa)
- **Infra**: Docker Compose ou instalação nativa (Oracle Cloud VM)

## Setup do banco
- Schema SQL em `db/schema/` (7 arquivos numerados, executam em ordem alfabética)
- Seed sintético em `db/seed/01_seed.sql`
- Docker: `docker compose up -d db` (roda tudo automaticamente)
- Nativo: ver README.md "Opção B"

## Comandos úteis
- Subir banco (Docker): `docker compose up -d db`
- Resetar banco: `docker compose down -v && docker compose up -d db`
- Conectar: `psql -U bioguard -d bioguardians`
- Refresh views: `SELECT refresh_dashboard();`

## Estrutura do schema
1. `01_extensions.sql` — PostGIS, pgcrypto
2. `02_enums_domains.sql` — enums (categoria_ameaca, esfera, etc.) e domínios
3. `03_tables.sql` — tabelas em 3FN com constraints e FKs
4. `04_indexes.sql` — GIST (espaciais) + B-tree (filtros)
5. `05_functions.sql` — funções PL/pgSQL e SQL (consultas espaciais, refresh)
6. `06_triggers.sql` — auditoria, validação de geometria, timestamps
7. `07_materialized_views.sql` — dashboard_stats, especies_por_uc, rankings

## Decisões de modelagem
- SRID 4326 (WGS84) para todas as geometrias
- `nome_cientifico` em domínio próprio (lowercase, trim)
- UF em domínio `CHAR(2)` maiúsculo
- Taxonomia hierárquica com auto-referência (reino → gênero)
- Auditoria via trigger genérico (to_jsonb do registro inteiro)
- Views materializadas com refresh simples (não CONCURRENTLY dentro de função)
