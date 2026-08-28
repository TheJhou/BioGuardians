# BioGuardians

Sistema de banco de dados espacial (PostgreSQL + PostGIS) para gestão de
**espécies ameaçadas** e **áreas protegidas** no Brasil, com aplicação web
(Node.js + React + Google Maps) como camada fina de demonstração.

> Projeto da disciplina de **Banco de Dados** — foco em modelagem, persistência,
> consultas espaciais, integridade e recursos avançados de BD.

## Estrutura

```
BioGuardians/
├── docker-compose.yml        # PostgreSQL 16 + PostGIS 3.4
├── .env.example              # variáveis de ambiente (copiar para .env)
├── db/
│   ├── init/00_init.sh       # roda schema + seed na 1ª inicialização
│   ├── schema/               # DDL (executado na 1ª inicialização do container)
│   │   ├── 01_extensions.sql
│   │   ├── 02_enums_domains.sql
│   │   ├── 03_tables.sql
│   │   ├── 04_indexes.sql
│   │   ├── 05_functions.sql
│   │   ├── 06_triggers.sql
│   │   └── 07_materialized_views.sql
│   └── seed/
│       └── 01_seed.sql       # dados sintéticos (espécies, UCs, ocorrências)
├── docs/
│   ├── PROJECT_PLAN.md       # plano completo do projeto
│   ├── DATA_DICTIONARY.md    # dicionário de dados (tabelas, colunas, tipos)
│   └── ERD.md                # modelo entidade-relacionamento
├── backend/                  # API Node.js (próxima etapa)
└── frontend/                 # React + Google Maps (próxima etapa)
```

## Como subir o banco

### Opção A — Docker Compose (recomendado)

Pré-requisito: Docker + Docker Compose.

```bash
cp .env.example .env          # ajuste usuário/senha se quiser
docker compose up -d db
```

Na **primeira** inicialização o container executa automaticamente, em ordem
alfabética, todos os scripts de `db/schema` e depois `db/seed`. Para reiniciar
do zero (apaga os dados):

```bash
docker compose down -v
docker compose up -d db
```

### Opção B — Instalação nativa (Linux / Oracle Cloud VM)

```bash
# 1. Instalar PostgreSQL 16 + PostGIS (Ubuntu/Debian)
sudo apt install -y postgresql-16 postgresql-16-postgis-3

# 2. Criar banco e usuário
sudo -u postgres createuser bioguard --superuser
sudo -u postgres psql -c "ALTER USER bioguard WITH PASSWORD 'bioguard';"
sudo -u postgres createdb bioguardians -O bioguard

# 3. Rodar schema e seed em ordem
for f in db/schema/*.sql; do
    echo "-> $f"
    psql -U bioguard -d bioguardians -f "$f"
done
for f in db/seed/*.sql; do
    echo "-> $f"
    psql -U bioguard -d bioguardians -f "$f"
done
```

### Conectar

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

## Fontes de dados (referência)

| Fonte | Formato | Uso |
|-------|---------|-----|
| MMA — espécies ameaçadas | CSV | Carga inicial (futuro) |
| CNUC/MMA — UCs | Shapefile | Carga via `shp2pgsql` (futuro) |
| GBIF — ocorrências | API REST | Consulta em tempo real (futuro) |
| Seed sintético | SQL | **Atual**: demonstração sem dependências externas |
