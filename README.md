# BioGuardians

Sistema de banco de dados espacial (PostgreSQL + PostGIS) para gestão de
**espécies ameaçadas** e **áreas protegidas** no Brasil, com aplicação web
(Node.js + React + Google Maps) como camada fina de demonstração.

> Projeto da disciplina de **Banco de Dados** — foco em modelagem, persistência,
> consultas espaciais, integridade e recursos avançados de BD.

## Estrutura

```
BioGuardians/
├── docker-compose.yml            # PostgreSQL 16 + PostGIS 3.4 + migrate service
├── .env.example                  # variáveis de ambiente (copiar para .env)
├── .github/workflows/ci.yml      # CI: migrations + smoke tests
├── db/
│   ├── migrate.sh                # migration runner (journal + SHA-256 hash)
│   ├── migrations/               # SQL migrations (applied in order)
│   │   ├── 001_extensions.sql
│   │   ├── 002_enums_domains.sql
│   │   ├── 003_tables.sql
│   │   ├── 004_indexes.sql
│   │   ├── 005_functions.sql
│   │   ├── 006_triggers.sql
│   │   ├── 007_materialized_views.sql
│   │   └── 008_seed_data.sql
│   └── tests/
│       └── smoke_test.sql        # CI validation (tables, spatial, triggers, views)
├── docs/
│   ├── PROJECT_PLAN.md           # plano completo do projeto
│   ├── DATA_DICTIONARY.md        # dicionário de dados (tabelas, colunas, tipos)
│   └── ERD.md                    # modelo entidade-relacionamento
├── backend/                      # API Node.js (próxima etapa)
└── frontend/                     # React + Google Maps (próxima etapa)
```

## Como subir o banco

### Opção A — Docker Compose (recomendado)

Pré-requisito: Docker + Docker Compose.

```bash
cp .env.example .env
docker compose up -d db          # sobe o PostgreSQL + PostGIS
docker compose run --rm migrate  # aplica as migrations
```

Para reiniciar do zero (apaga os dados):

```bash
docker compose down -v
docker compose up -d db
docker compose run --rm migrate
```

### Opção B — Instalação nativa (Linux / Oracle Cloud VM)

```bash
# 1. Instalar PostgreSQL 16 + PostGIS (Ubuntu/Debian)
sudo apt install -y postgresql-16 postgresql-16-postgis-3

# 2. Criar banco e usuário
sudo -u postgres createuser bioguard --superuser
sudo -u postgres psql -c "ALTER USER bioguard WITH PASSWORD 'bioguard';"
sudo -u postgres createdb bioguardians -O bioguard

# 3. Aplicar migrations
sh db/migrate.sh
```

## Sistema de Migrations

O projeto usa um sistema de migrations customizado (`db/migrate.sh`) que:

- Aplica arquivos SQL de `db/migrations/` em ordem alfabética
- Rastreia migrations aplicadas na tabela `schema_migrations`
- Calcula hash **SHA-256** de cada arquivo para detectar adulteração
- Cada migration roda numa **transação** — se falhar, é revertida e pode ser re-executada
- É **idempotente** — rodar de novo pula o que já foi aplicado

### Comandos

```bash
sh db/migrate.sh             # aplica migrations pendentes
sh db/migrate.sh --status    # mostra status de cada migration
sh db/migrate.sh --dry-run   # mostra o que seria aplicado (sem alterar)
```

### Criar nova migration

```bash
# Siga a numeração sequencial
touch db/migrations/009_add_nova_coluna.sql
# edite o arquivo com o DDL...
sh db/migrate.sh             # aplica
```

> **Importante**: nunca edite uma migration que já foi aplicada em produção.
> O hash SHA-256 detecta a alteração e bloqueia a execução.

### Smoke tests

```bash
psql -U bioguard -d bioguardians -f db/tests/smoke_test.sql
```

Valida: tabelas, seed data, `ST_Contains`, funções espaciais, views
materializadas, triggers de auditoria e validação de geometria.

## CI/CD

O GitHub Actions (`.github/workflows/ci.yml`) roda a cada push/PR:

1. Sobe um container PostGIS temporário
2. Aplica as migrations
3. Roda os smoke tests
4. Verifica idempotência (roda migrations de novo — deve pular todas)

## Conectar

```bash
# Docker
docker compose exec db psql -U bioguard -d bioguardians

# Nativo
psql -U bioguard -d bioguardians
```

## Consultas de exemplo

```sql
-- Espécies ameaçadas dentro de uma UC (query espacial)
SELECT * FROM especies_em_area(1);

-- UCs que protegem a espécie X
SELECT * FROM areas_protegem_especie(
    (SELECT id FROM especie WHERE nome_cientifico = 'panthera onca')
);

-- Dashboard (view materializada)
SELECT * FROM dashboard_stats;
SELECT * FROM ranking_especies_categoria;
SELECT * FROM ucs_por_esfera;

-- Atualizar views após carga/alteração
SELECT refresh_dashboard();

-- Auditoria
SELECT tabela, operacao, timestamp, dados_novos
FROM log_auditoria ORDER BY timestamp DESC LIMIT 20;
```

## Recursos de BD implementados

- **PostGIS**: colunas `geometry`, `ST_Contains`, `ST_Within`, `ST_AsGeoJSON`,
  `ST_MakeEnvelope`, índices **GIST**.
- **Constraints**: `CHECK` (categoria, geometria, lat/lon), `UNIQUE`
  (nome_cientifico), FKs com `ON DELETE RESTRICT/CASCADE/SET NULL`.
- **Enums/Domínios**: `categoria_ameaca_tipo`, `esfera_tipo`,
  `categoria_uc_tipo`, `rank_taxonomia_tipo`, `nome_cientifico_dom`, `uf_dom`.
- **Triggers**: auditoria (`log_auditoria`), validação de geometria,
  sincronização `geom` a partir de `lat/lon`, `updated_at` automático.
- **Funções PL/pgSQL**: `especies_em_area`, `areas_protegem_especie`,
  `contar_ocorrencias_em_area`, `refresh_dashboard`.
- **Views materializadas**: `dashboard_stats`, `especies_por_uc`,
  `ranking_especies_categoria`, `ucs_por_esfera` (refresh `CONCURRENTLY`).
- **Índices**: GIST (geometrias), B-tree (filtros), índice parcial.
- **Migrations**: sistema customizado com journal table, hash SHA-256,
  transações atômicas, idempotência.

## Fontes de dados (referência)

| Fonte | Formato | Uso |
|-------|---------|-----|
| MMA — espécies ameaçadas | CSV | Carga inicial (futuro) |
| CNUC/MMA — UCs | Shapefile | Carga via `shp2pgsql` (futuro) |
| GBIF — ocorrências | API REST | Consulta em tempo real (futuro) |
| Seed sintético | SQL | **Atual**: demonstração sem dependências externas |
