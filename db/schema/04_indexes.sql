-- ============================================================
-- BioGuardians - 04 Índices
-- GIST para geometrias (consultas espaciais) e B-tree para
-- colunas usadas em filtros/joins frequentes.
-- ============================================================

-- Índices espaciais (núcleo das consultas ST_Contains / ST_Within).
CREATE INDEX idx_area_protegida_geom ON area_protegida USING GIST (geom);
CREATE INDEX idx_ocorrencia_geom     ON ocorrencia     USING GIST (geom);

-- Filtros comuns em listagens/filtros da interface.
CREATE INDEX idx_especie_categoria   ON especie(categoria_ameaca);
CREATE INDEX idx_especie_status      ON especie(status);
CREATE INDEX idx_especie_nome_popular ON especie(nome_popular);

CREATE INDEX idx_area_protegida_esfera   ON area_protegida(esfera);
CREATE INDEX idx_area_protegida_categoria ON area_protegida(categoria_uc);
CREATE INDEX idx_area_protegida_bioma    ON area_protegida(bioma_id);

CREATE INDEX idx_ocorrencia_especie  ON ocorrencia(especie_id);
CREATE INDEX idx_ocorrencia_fonte    ON ocorrencia(fonte);
CREATE INDEX idx_ocorrencia_data     ON ocorrencia(data_evento);

-- Índice parcial: ocorrências georreferenciadas válidas (aceleram
-- joins espaciais com UCs).
CREATE INDEX idx_ocorrencia_geom_validos
    ON ocorrencia USING GIST (geom)
    WHERE geom IS NOT NULL;
