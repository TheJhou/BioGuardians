# Cache Persistente de Tiles — `generateAreaTiles.ts`

Documento sobre o script `backend/scripts/generateAreaTiles.ts`, a tabela
`area_tile` (migration 004) e por que esse mecanismo existe.

## O problema que ele resolve

As Unidades de Conservação são polígonos **muito pesados**:

- `area_protegida`: 3.371 geometrias, ~63 MB, média de ~1.100 vértices por
  polígono
- As piores chegam a **130 mil vértices** (Flona Itaituba, APA Tamoios etc.)

O endpoint `GET /api/areas/tiles/:z/:x/:y.mvt` gerava cada tile na hora:
o índice GIST encontrava os polígonos rápido, mas depois o PostGIS precisava
rodar `ST_Transform` + `ST_SimplifyPreserveTopology` + `ST_AsMVTGeom` sobre
centenas de polígonos gigantes **a cada requisição**. Em zoom baixo (z3–z5)
um único tile cobre meio Brasil e intersecta milhares de polígonos — a
geração fria levava de **1 a 4 segundos por tile**.

Resultado visível: o mapa "nascia" quadrado por quadrado, devagar, porque o
trabalho de vértice acontecia no request path. CPU e RAM sobrando não
resolviam — era volume bruto de processamento geométrico repetido para o
mesmo resultado.

Como UCs praticamente não mudam (e quando mudam, é uma adição), pagar esse
custo por requisição não faz sentido.

## A solução

Gerar cada tile **uma única vez** e guardar o binário `.mvt` pronto no
próprio Postgres:

```sql
CREATE TABLE area_tile (
    z         SMALLINT    NOT NULL,
    x         INTEGER     NOT NULL,
    y         INTEGER     NOT NULL,
    tile      BYTEA       NOT NULL,
    gerado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (z, x, y)
);
```

O request passa a ser um `SELECT` de uma linha — **~10–20 ms**, frio ou
quente, sem depender de cache em memória, sem warm-up de boot e sem
reprocessar geometria.

## Como o script funciona

`backend/scripts/generateAreaTiles.ts` — executado via tsx, direto no banco
(sem passar por HTTP nem exigir o servidor rodando):

1. **Descobre o que gerar**: `ST_Extent(geom)` retorna o bounding box real
   de todas as áreas — só os tiles que cobrem dado entram na fila, não o
   globo inteiro
2. **Enumera os tiles** para cada zoom no intervalo (default z3–z6)
   convertendo o bbox em coordenadas slippy-map x/y
3. **Gera cada tile** com a mesma query MVT da rota (extraída para
   `backend/src/tileStore.ts`, usada pelos dois caminhos)
4. **Persiste com upsert** (`ON CONFLICT DO UPDATE`) — idempotente, pode
   rodar quantas vezes quiser
5. Concorrência de 4 workers; erros em tiles individuais são contados mas
   não abortam a execução

```bash
npm run generate-area-tiles          # z3–z6 (default, ~118 tiles, ~10s)
npm run generate-area-tiles -- 3 8   # z3–z8
```

Primeira execução real: 118 tiles, 401 KB, 0 erros, ~10 s.

## O fluxo completo em runtime

```
GET /api/areas/tiles/z/x/y.mvt
  ├─ sem filtros (esfera/categoria/bioma):
  │    ├─ SELECT tile FROM area_tile → hit: devolve bytea (~10–20 ms)
  │    └─ miss: gera na hora + INSERT na tabela → próximo request vira hit
  │       (self-healing — cobre zooms altos não pré-gerados)
  └─ com filtros:
       └─ caminho antigo: LRU em memória (1h) + query dinâmica
          (tiles filtrados são variantes; não vão pra tabela)
```

Por que só sem filtro usa a tabela: um tile pré-gerado representa o dataset
completo. Cada combinação de filtro geraria uma variante diferente do mesmo
z/x/y — a chave da tabela não comportaria isso sem explodir em cardinalidade.

## Invalidação

Quando uma área é criada, alterada ou removida (`POST/PUT/DELETE
/api/areas`), a rota apaga **somente os tiles cuja bounding box intersecta
a geometria afetada** (`invalidateAreaTilesForArea` /
`invalidateAreaTilesForGeom` em `tileStore.ts`). Eles se re-geram sozinhos
no próximo request via miss + upsert — não é preciso re-rodar o script.

Se preferir re-gerar tudo de uma vez (ex.: carga em massa de UCs):

```bash
npm run generate-area-tiles
```

ou, para invalidar tudo manualmente:

```sql
DELETE FROM area_tile;  -- tiles voltam a se gerar sob demanda
```

## Decisões e trade-offs

- **z3–z6 pré-gerados**: são os zooms caros (tiles grandes, muitos
  polígonos). z7+ tem poucos polígonos por tile e se auto-popula na primeira
  requisição — pré-gerar seria desperdício de espaço.
- **Warm-up de boot reduzido**: `tileWarmup.ts` agora aquece só ocorrências
  (pontos são leves; áreas não dependem mais de memória).
- **Dado novo não aparece sozinho**: tiles pré-gerados servem a versão
  gravada até a invalidação rodar — aceitável porque UCs são estáticas.
- **Custo de manutenção**: uma tabela pequena (~500 KB), um script
  idempotente e invalidação cirúrgica — em troca, o pior caso de latência
  caiu de ~4 s para ~20 ms.

## Arquivos relacionados

| Arquivo | Papel |
|---|---|
| `db/migrations/004_area_tile_cache.sql` | cria a tabela `area_tile` |
| `backend/src/tileStore.ts` | geração, leitura, upsert e invalidação |
| `backend/src/routes/areas.ts` | rota que consulta a tabela e faz miss+upsert |
| `backend/scripts/generateAreaTiles.ts` | geração em massa (este script) |
| `backend/src/tileWarmup.ts` | warm-up de boot (só ocorrências agora) |
