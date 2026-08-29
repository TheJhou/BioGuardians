# BioGuardians - Data Loading Scripts

This directory contains scripts to populate the database with real data
from official Brazilian biodiversity sources.

## Data Sources

### 1. MMA — Ministério do Meio Ambiente

**What**: Official list of threatened species in Brazil.

**Legal basis**:
- **Portaria MMA Nº 148, de 7 de junho de 2022** — Lista de espécies
  ameaçadas de extinção da fauna brasileira (298 espécies).
- **Portaria MMA Nº 445, de 18 de dezembro de 2014** — Lista de espécies
  ameaçadas de extinção da flora brasileira (2.113 espécies).
- **Portaria MMA Nº 443, de 17 de dezembro de 2014** — Lista de espécies
  ameaçadas de extinção da fauna (atualizada pela 148/2022).
- **Portaria MMA Nº 444, de 17 de dezembro de 2014** — Lista de espécies
  aquáticas ameaçadas de extinção.

**Categories used** (IUCN/MMA):
| Código | Nome | Descrição |
|--------|------|-----------|
| CR | Criticamente em Perigo | Risco altíssimo de extinção |
| EN | Em Perigo | Risco muito alto de extinção |
| VU | Vulnerável | Risco alto de extinção |
| NT | Quase Ameaçada | Próxima de qualificar como ameaçada |
| LC | Menos Preocupante | Ampla distribuição, população estável |
| DD | Dados Insuficientes | Informação inadequada para avaliação |

**Where to download**:
- Fauna: https://www.gov.br/mma/pt-br/temas/conservacao-da-biodiversidade/fauna-brasileira
- Flora: https://www.gov.br/mma/pt-br/temas/conservacao-da-biodiversidade/flora-brasileira
- Or directly from the MMA portal: https://www.mma.gov.br/

**Format**: CSV (semicolon-separated, UTF-8)
**Sample**: `input/mma_especies.csv` — 96 real threatened species included.

---

### 2. CNUC — Cadastro Nacional de Unidades de Conservação

**What**: National registry of protected areas (UCs) in Brazil, managed
by MMA. Contains boundaries, categories, administration sphere, and
metadata for all federal, state, municipal, and private UCs.

**Legal basis**:
- **Lei Nº 9.985, de 18 de julho de 2000** — SNUC (Sistema Nacional
  de Unidades de Conservação da Natureza).
- **Decreto Nº 4.340, de 22 de agosto de 2002** — Regulamentação do SNUC.

**Categories (SNUC)**:
| Our enum | SNUC category | Description |
|----------|---------------|-------------|
| protecao_integral | Proteção Integral | Uso indireto dos recursos (não consome) |
| uso_sustentavel | Uso Sustentável | Uso direto sustentável dos recursos |

**Protection Integral subcategories**: Parque Nacional, Reserva Biológica,
Estação Ecológica, Monumento Natural, Refúgio de Vida Silvestre.

**Uso Sustentável subcategories**: Floresta Nacional, Reserva Extrativista,
Reserva de Fauna, Área de Proteção Ambiental, Área de Relevante Interesse
Ecológico, Reserva de Desenvolvimento Sustentável, Reserva Particular
do Patrimônio Natural.

**Administration spheres**: federal, estadual, municipal, particular.

**Where to download**:
- CNUC portal: http://cnuc.mma.gov.br/
- Direct download (shapefile): http://cnuc.mma.gov.br/cnuc/app/gerenciar_dados_abertos
- GeoServer WFS/WMS: http://geoserver.mma.gov.br/

**Format**: Shapefile (SHP, SHX, DBF, PRJ)
**SRID**: 4326 (WGS84) — converted automatically by the script.

---

### 3. GBIF — Global Biodiversity Information Facility

**What**: International network and data infrastructure that provides
open access to biodiversity data from museums, herbaria, research
institutions, and citizen science platforms worldwide.

**Coverage**: ~2.5 billion occurrence records globally, including
Brazilian data from:
- SpeciesLink (Brazilian herbaria and museums)
- INPA (Instituto Nacional de Pesquisas da Amazônia)
- MPEG (Museu Paraense Emílio Goeldi)
- ZUEC (Museu de Zoologia Unicamp)
- And hundreds of other institutions

**API**:
- Base URL: `https://api.gbif.org/v1`
- Endpoint: `/occurrence/search`
- Parameters used: `country=BR`, `scientificName`, `hasCoordinate=true`
- Rate limit: 500ms between requests (self-imposed, be nice)
- No API key required (public API)

**Documentation**: https://www.gbif.org/developer/summary
**Brazilian portal**: https://www.gbif.org/country/BR/summary

**Data fields extracted**:
| GBIF field | Our column | Description |
|------------|------------|-------------|
| decimalLatitude | lat | Latitude in decimal degrees |
| decimalLongitude | lon | Longitude in decimal degrees |
| eventDate | data_evento | Date of observation/collection |
| institutionCode | base_registro | Source institution code |

**Filter**: Only occurrences with coordinates within Brazil (`country=BR`).

---

### 4. speciesLink — Rede speciesLink

**What**: Brazilian network of biological collections that aggregates
and provides open access to occurrence data from herbaria, museums,
and biological collections across Brazil.

**Coverage**: ~10 million records from ~400 collections, including:
- Herbaria (e.g., SP, RB, BHCB, CESJ, HUEFS)
- Zoological museums (e.g., MZUSP, MPEG, INPA)
- Microorganism collections

**Maintainer**: Centro de Referência em Informação Ambiental (CRIA)
**Website**: https://www.splink.org.br/
**API documentation**: https://api.splink.org.br/

**API**:
- Base URL: `https://api.splink.org.br/records`
- Endpoint: `/search`
- Parameters: `scientificname`, `format=json`
- Rate limit: 1000ms between requests (self-imposed)
- No API key required (public API)

**Data fields extracted**:
| speciesLink field | Our column | Description |
|-------------------|------------|-------------|
| decimalLatitude / latitude | lat | Latitude |
| decimalLongitude / longitude | lon | Longitude |
| eventDate / collectorDate | data_evento | Collection date |
| institutionCode / institution | base_registro | Source collection |

---

## Prerequisites

```bash
# Copy .env and set credentials
cp .env.example .env

# Install dependencies (pg for Node.js scripts)
cd scripts/data
npm install
```

For CNUC shapefile loading, also required:
- `shp2pgsql` (bundled with PostGIS)
- `psql` (PostgreSQL client)

```bash
# Ubuntu/Debian
sudo apt install postgis postgresql-client

# macOS
brew install postgis libpq
```

## Available Scripts

### 1. MMA — Espécies Ameaçadas

**Input**: CSV file in `input/mma_especies.csv`
**Script**: `load_mma_especies.mjs`

```bash
# Use the provided sample (96 real species)
node load_mma_especies.mjs

# Or use a custom CSV
node load_mma_especies.mjs --file=input/custom_mma.csv
```

**CSV format** (UTF-8, semicolon-separated):
```
nome_cientifico;nome_popular;categoria;reino;filo;classe;ordem;familia;genero;biomas;estados
panthera onca;onça-pintada;VU;Animalia;Chordata;Mammalia;Carnivora;Felidae;Panthera;Amazônia,Mata Atlântica;AC,AM,AP,MT,MS,PA,RO,RR,TO,MA,PI,BA,MG,SP,PR,SC,RS
```

**What it does**:
1. Parses CSV with species data
2. Creates taxonomy chain (reino → filo → classe → ordem → familia → genero)
3. Inserts species with `ON CONFLICT (nome_cientifico) DO NOTHING`
4. Links species to biomas (N:N via `especie_bioma`)
5. Links species to estados (N:N via `especie_estado`)

### 2. CNUC — Unidades de Conservação

**Input**: Shapefile in `input/cnuc_ucs/`
**Script**: `load_cnuc_ucs.mjs`

```bash
# Download shapefile from CNUC (http://cnuc.mma.gov.br/)
# Extract to: scripts/data/input/cnuc_ucs/

node load_cnuc_ucs.mjs

# Or specify a custom directory
node load_cnuc_ucs.mjs --dir=input/custom_cnuc
```

**What it does**:
1. Runs `shp2pgsql` to convert shapefile to SQL (SRID 4326)
2. Creates temporary table with raw shapefile data
3. Auto-detects column names (nome, categoria, esfera, area, bioma, geom)
4. Maps CNUC categories to `categoria_uc_tipo` enum
5. Maps administration spheres to `esfera_tipo` enum
6. Inserts into `area_protegida` with `ON CONFLICT (nome) DO NOTHING`
7. Links biomas if bioma column exists
8. Cleans up temporary table

### 3. GBIF — Ocorrências

**Script**: `load_gbif_ocorrencias.mjs`

```bash
# Loads occurrences for all active species (limit 50 per species)
node load_gbif_ocorrencias.mjs

# Or for a specific species
node load_gbif_ocorrencias.mjs --especie="panthera onca"

# Or with a custom limit per species
node load_gbif_ocorrencias.mjs --limit=100
```

**What it does**:
1. Queries all active species from `especie` table
2. For each species, calls GBIF API (`/occurrence/search?country=BR`)
3. Filters results with valid coordinates
4. Checks for duplicates via `(especie_id, lat, lon, fonte='gbif')`
5. Inserts into `ocorrencia` with `geom = ST_MakePoint(lon, lat)`
6. Rate-limits at 500ms between API calls
7. Refreshes dashboard materialized views at the end

### 4. speciesLink — Ocorrências

**Script**: `load_specieslink_ocorrencias.mjs`

```bash
# Loads occurrences for all active species
node load_specieslink_ocorrencias.mjs

# Or for a specific species
node load_specieslink_ocorrencias.mjs --especie="panthera onca"
```

**What it does**:
1. Queries all active species from `especie` table
2. For each species, calls speciesLink API (`/records/search`)
3. Parses coordinates from various field name formats
4. Checks for duplicates via `(especie_id, lat, lon, fonte='specieslink')`
5. Inserts into `ocorrencia` with `geom = ST_MakePoint(lon, lat)`
6. Rate-limits at 1000ms between API calls
7. Refreshes dashboard materialized views at the end

## Environment Variables

All scripts read from the root `.env` file:

```
DB_USER=bioguard
DB_PASSWORD=***
DB_NAME=bioguardians
DB_HOST=localhost
DB_PORT=5432
GBIF_API_BASE=https://api.gbif.org/v1
```

## Running Order

For a full data load from scratch:

```bash
# 1. Load species first (MMA)
node load_mma_especies.mjs

# 2. Load protected areas (CNUC)
node load_cnuc_ucs.mjs

# 3. Load occurrences (GBIF + speciesLink)
node load_gbif_ocorrencias.mjs
node load_specieslink_ocorrencias.mjs
```

Or run all at once:

```bash
npm run load:all
```

### 5. Enriquecer resumos de espécies

**Script**: `enrich_species_descriptions.mjs`

```bash
# Busca resumos em Wikipedia (PT/EN), Wikidata e iNaturalist
npm run enrich:descriptions

# Testar sem salvar e limitar a 10 espécies
node enrich_species_descriptions.mjs --dry-run --limit=10
```

**What it does**:
1. Queries species without `descricao`
2. Tries multiple sources (Wikipedia PT/EN, Wikidata, iNaturalist)
3. Prefers popular name, then scientific name
4. Validates that the extract mentions the species name
5. Updates `especie.descricao` in the database
6. Rate-limits at 300ms between API calls

## Notes

- Scripts are **idempotent** — running twice won't duplicate data
- MMA and CNUC scripts require manual download of source files
- GBIF and speciesLink scripts use public APIs (no API key needed)
- All inserts use parameterized queries (SQL injection safe)
- The `fonte` column in `ocorrencia` tracks the data source
- Dashboard materialized views are refreshed after each load
- Rate limits are self-imposed to be respectful to public APIs

## Data License

| Source | License | Notes |
|--------|---------|-------|
| MMA | Open data (Decreto 10.046/2019) | Government open data |
| CNUC | Open data (Decreto 10.046/2019) | Government open data |
| GBIF | CC-BY 4.0 | Attribution required |
| speciesLink | CC-BY 4.0 | Attribution required, varies by collection |
