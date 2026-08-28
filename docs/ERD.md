# BioGuardians — Modelo Entidade-Relacionamento (ERD)

Diagrama textual das entidades, relacionamentos e cardinalidades.

---

## Visão Geral

```
                    ┌──────────────────┐
                    │ categoria_ameaca │
                    │   (PK: codigo)   │
                    └────────┬─────────┘
                             │ 1
                             │
                             │ N
                    ┌────────▼─────────┐         ┌──────────┐
                    │     especie      │ N───────│  bioma   │ N
                    │   (PK: id)       │  N:N    │(PK: id)  │
                    └──┬────┬────┬─────┘         └──────────┘
                       │    │    │  N
                  ┌────┘    │    └──────┐ N        ┌──────────┐
                  │ N       │ N         │  N:N    │  estado  │ N
                  │    ┌────▼─────┐     │─────────│ (PK: uf) │
                  │    │  taxon   │     │         └──────────┘
                  │ N  │ (PK: id) │     │
                  │    │ self-ref │     │
                  │ 1  └──────────┘     │
                  │                     │ N
            ┌─────▼──────┐        ┌─────▼──────┐
            │especie_bioma│        │especie_   │
            │ (N:N join)  │        │  estado   │
            └─────────────┘        │ (N:N join)│
                                   └────────────┘

                    ┌──────────────────┐
                    │  area_protegida  │
                    │   (PK: id)       │
                    │   geom: MULTIPOL │
                    └────────┬─────────┘
                             │ 1
                             │ ST_Contains(geom, ponto)
                             │ N
                    ┌────────▼─────────┐
                    │   ocorrencia     │ N───────► especie(id)
                    │   (PK: id)       │  N:1     (FK CASCADE)
                    │   geom: POINT    │
                    └──────────────────┘

                    ┌──────────────────┐
                    │ log_auditoria    │
                    │   (PK: id)       │  ← trigger AFTER INSERT/UPDATE/DELETE
                    │   em especie,    │     em especie e area_protegida
                    │   area_protegida │
                    └──────────────────┘
```

---

## Entidades e Relacionamentos

### 1. `categoria_ameaca` ↔ `especie` (1:N)

- Uma categoria de ameaça classifica **muitas** espécies.
- Uma espécie tem **exatamente uma** categoria de ameaça.
- FK: `especie.categoria_ameaca → categoria_ameaca.codigo` (ON DELETE RESTRICT)

### 2. `taxon` ↔ `especie` (1:N via gênero)

- Um táxon de rank `genero` classifica **muitas** espécies.
- Uma espécie pertence a **exatamente um** gênero.
- FK: `especie.genero_id → taxon(id)` (ON DELETE RESTRICT)

### 3. `taxon` ↔ `taxon` (auto-referência, 1:N)

- Um táxon pai tem **muitos** táxons filhos.
- Um táxon filho tem **um** táxon pai (ou NULL para reino).
- FK: `taxon.parent_id → taxon(id)` (ON DELETE RESTRICT)

Hierarquia: `reino → filo → classe → ordem → familia → genero`

### 4. `especie` ↔ `bioma` (N:N)

- Uma espécie ocorre em **um ou mais** biomas.
- Um bioma abriga **muitas** espécies.
- Tabela de junção: `especie_bioma(especie_id, bioma_id)`
- FKs: `especie_id → especie(id) ON DELETE CASCADE`, `bioma_id → bioma(id) ON DELETE RESTRICT`

### 5. `especie` ↔ `estado` (N:N)

- Uma espécie ocorre em **um ou mais** estados.
- Um estado abriga **muitas** espécies.
- Tabela de junção: `especie_estado(especie_id, estado_uf)`
- FKs: `especie_id → especie(id) ON DELETE CASCADE`, `estado_uf → estado(uf) ON DELETE RESTRICT`

### 6. `bioma` ↔ `area_protegida` (1:N)

- Um bioma contém **muitas** áreas protegidas.
- Uma área protegida está em **um** bioma (ou NULL).
- FK: `area_protegida.bioma_id → bioma(id)` (ON DELETE SET NULL)

### 7. `especie` ↔ `ocorrencia` (1:N)

- Uma espécie tem **muitas** ocorrências.
- Uma ocorrência refere-se a **exatamente uma** espécie.
- FK: `ocorrencia.especie_id → especie(id)` (ON DELETE CASCADE)

### 8. `area_protegida` ↔ `ocorrencia` (relação espacial implícita, N:N)

- **Não há FK explícita** — a relação é espacial.
- Uma área protegida contém **muitas** ocorrências (via `ST_Contains`).
- Uma ocorrência pode estar dentro de **zero ou mais** áreas protegidas.
- Consulta: `SELECT * FROM especies_em_area(:area_id)`

### 9. `especie` / `area_protegida` → `log_auditoria` (via trigger)

- Toda operação INSERT/UPDATE/DELETE em `especie` ou `area_protegida` gera
  **uma** entrada em `log_auditoria`.
- Trigger: `trg_auditar()` (AFTER INSERT/UPDATE/DELETE, FOR EACH ROW)
- Captura `dados_anteriores` (JSONB do OLD) e `dados_novos` (JSONB do NEW).

---

## Cardinalidade Resumida

| Entidade 1 | Relação | Entidade 2 | Cardinalidade | Mecanismo |
|------------|---------|------------|---------------|-----------|
| categoria_ameaca | classifica | especie | 1:N | FK |
| taxon (genero) | classifica | especie | 1:N | FK |
| taxon (pai) | contém | taxon (filho) | 1:N | auto-ref FK |
| especie | ocorre em | bioma | N:N | tabela join |
| especie | ocorre em | estado | N:N | tabela join |
| bioma | contém | area_protegida | 1:N | FK |
| especie | tem | ocorrencia | 1:N | FK CASCADE |
| area_protegida | contém | ocorrencia | N:N espacial | ST_Contains |
| especie/area | audita | log_auditoria | 1:N | trigger |

---

## Índices

| Índice | Tabela | Tipo | Coluna(s) | Propósito |
|--------|--------|------|-----------|-----------|
| `idx_area_protegida_geom` | area_protegida | GIST | geom | ST_Contains/ST_Within |
| `idx_ocorrencia_geom` | ocorrencia | GIST | geom | ST_Contains/ST_Within |
| `idx_ocorrencia_geom_validos` | ocorrencia | GIST (parcial) | geom | Acelera join espacial |
| `idx_especie_categoria` | especie | B-tree | categoria_ameaca | Filtro por categoria |
| `idx_especie_status` | especie | B-tree | status | Filtro por status |
| `idx_especie_nome_popular` | especie | B-tree | nome_popular | Busca por nome |
| `idx_area_protegida_esfera` | area_protegida | B-tree | esfera | Filtro por esfera |
| `idx_area_protegida_categoria` | area_protegida | B-tree | categoria_uc | Filtro por categoria |
| `idx_area_protegida_bioma` | area_protegida | B-tree | bioma_id | Filtro por bioma |
| `idx_ocorrencia_especie` | ocorrencia | B-tree | especie_id | Join com especie |
| `idx_ocorrencia_fonte` | ocorrencia | B-tree | fonte | Filtro por fonte |
| `idx_ocorrencia_data` | ocorrencia | B-tree | data_evento | Filtro por data |
| `idx_taxon_parent` | taxon | B-tree | parent_id | Navegação hierárquica |
| `idx_taxon_rank` | taxon | B-tree | rank | Filtro por rank |
| `idx_log_tabela_ts` | log_auditoria | B-tree | (tabela, timestamp DESC) | Consulta de log |
