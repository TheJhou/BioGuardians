-- ============================================================
-- BioGuardians - 10 Suporte a Cache
-- Tabela de metadados de cache + trigger de invalidacao.
-- O backend Node.js consulta esta tabela para saber se
-- precisa recarregar dados do banco ou pode servir do cache.
-- ============================================================

-- ---------- Tabela de metadados de cache ----------
CREATE TABLE cache_metadata (
    chave           VARCHAR(100) PRIMARY KEY,
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inicializa chaves de cache do dashboard.
INSERT INTO cache_metadata (chave) VALUES
    ('dashboard'),
    ('especies'),
    ('areas'),
    ('ocorrencias'),
    ('referencias');

-- ---------- Funcao trigger: invalida cache ----------
-- Toda vez que especie, area_protegida ou ocorrencia sao
-- modificadas (INSERT/UPDATE/DELETE), atualiza o timestamp
-- das chaves relacionadas para invalidar o cache do backend.
CREATE OR REPLACE FUNCTION trg_invalida_cache()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'especie' THEN
        UPDATE cache_metadata SET atualizado_em = now() WHERE chave IN ('especies', 'dashboard');
    ELSIF TG_TABLE_NAME = 'area_protegida' THEN
        UPDATE cache_metadata SET atualizado_em = now() WHERE chave IN ('areas', 'dashboard');
    ELSIF TG_TABLE_NAME = 'ocorrencia' THEN
        UPDATE cache_metadata SET atualizado_em = now() WHERE chave IN ('ocorrencias', 'dashboard');
    END IF;
    RETURN COALESCE(NEW, OLD);
END; $$;

-- ---------- Vinculacao dos triggers ----------
CREATE TRIGGER trg_cache_especie
    AFTER INSERT OR UPDATE OR DELETE ON especie
    FOR EACH ROW EXECUTE FUNCTION trg_invalida_cache();

CREATE TRIGGER trg_cache_area_protegida
    AFTER INSERT OR UPDATE OR DELETE ON area_protegida
    FOR EACH ROW EXECUTE FUNCTION trg_invalida_cache();

CREATE TRIGGER trg_cache_ocorrencia
    AFTER INSERT OR UPDATE OR DELETE ON ocorrencia
    FOR EACH ROW EXECUTE FUNCTION trg_invalida_cache();
