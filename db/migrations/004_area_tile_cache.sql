-- ============================================================
-- BioGuardians — 004: cache persistente de tiles vetoriais (áreas)
--
-- Os tiles MVT de UCs são pré-gerados e servidos direto da tabela.
-- A geometria pesada (média ~1.1k vértices/polígono, picos de ~130k)
-- sai do request path: um hit vira SELECT de uma linha (~10ms).
--
-- Populada por backend/scripts/generateAreaTiles.ts (z3-6) e por
-- miss + upsert na rota /api/areas/tiles (self-healing). Mutations
-- em area_protegida invalidam apenas os tiles intersectados.
-- ============================================================

CREATE TABLE IF NOT EXISTS area_tile (
    z         SMALLINT    NOT NULL,
    x         INTEGER     NOT NULL,
    y         INTEGER     NOT NULL,
    tile      BYTEA       NOT NULL,
    gerado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT area_tile_pk PRIMARY KEY (z, x, y)
);
