-- ============================================================
-- BioGuardians - 06 Triggers
-- 1) Validar geometria (área e ocorrência)
-- 2) Sincronizar geom de ocorrência a partir de lat/lon
-- 3) Auditoria de alterações (espécie e área protegida)
-- 4) Atualizar updated_at automaticamente
-- ============================================================

-- ---------- Funções utilitárias ----------

-- Garante que o ponto da ocorrência reflita lat/lon (lon = X, lat = Y).
CREATE OR REPLACE FUNCTION trg_ocorrencia_sincroniza_geom()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326);
    RETURN NEW;
END; $$;

-- Valida geometria de área protegida (deve ser válida e não vazia).
CREATE OR REPLACE FUNCTION trg_area_valida_geom()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT ST_IsValid(NEW.geom) THEN
        RAISE EXCEPTION 'Geometria inválida para a área protegida %', NEW.nome;
    END IF;
    IF ST_IsEmpty(NEW.geom) THEN
        RAISE EXCEPTION 'Geometria vazia não é permitida para %', NEW.nome;
    END IF;
    RETURN NEW;
END; $$;

-- Atualiza updated_at em UPDATE.
CREATE OR REPLACE FUNCTION trg_atualiza_timestamp()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.atualizado_em := now();
    RETURN NEW;
END; $$;

-- Auditoria genérica: registra INSERT/UPDATE/DELETE em log_auditoria.
-- Usada por especie e area_protegida.
CREATE OR REPLACE FUNCTION trg_auditar()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_op operacao_auditoria_tipo;
    v_id INTEGER;
    v_old JSONB;
    v_new JSONB;
BEGIN
    v_op := TG_OP::operacao_auditoria_tipo;
    IF v_op = 'DELETE' THEN
        v_id := OLD.id;
        v_old := to_jsonb(OLD);
        v_new := NULL;
    ELSIF v_op = 'UPDATE' THEN
        v_id := NEW.id;
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);
    ELSE  -- INSERT
        v_id := NEW.id;
        v_old := NULL;
        v_new := to_jsonb(NEW);
    END IF;

    INSERT INTO log_auditoria (tabela, operacao, registro_id, dados_anteriores, dados_novos)
    VALUES (TG_TABLE_NAME, v_op, v_id, v_old, v_new);

    RETURN COALESCE(NEW, OLD);
END; $$;

-- ---------- Vinculação dos triggers ----------

-- Ocorrência: sincroniza geom antes de INSERT/UPDATE.
CREATE TRIGGER trg_ocorrencia_geom
    BEFORE INSERT OR UPDATE OF lat, lon ON ocorrencia
    FOR EACH ROW EXECUTE FUNCTION trg_ocorrencia_sincroniza_geom();

-- Área protegida: valida geometria antes de INSERT/UPDATE.
CREATE TRIGGER trg_area_protegida_geom
    BEFORE INSERT OR UPDATE OF geom ON area_protegida
    FOR EACH ROW EXECUTE FUNCTION trg_area_valida_geom();

-- Timestamps de atualização.
CREATE TRIGGER trg_especie_ts
    BEFORE UPDATE ON especie
    FOR EACH ROW EXECUTE FUNCTION trg_atualiza_timestamp();

CREATE TRIGGER trg_area_protegida_ts
    BEFORE UPDATE ON area_protegida
    FOR EACH ROW EXECUTE FUNCTION trg_atualiza_timestamp();

-- Auditoria.
CREATE TRIGGER trg_especie_audit
    AFTER INSERT OR UPDATE OR DELETE ON especie
    FOR EACH ROW EXECUTE FUNCTION trg_auditar();

CREATE TRIGGER trg_area_protegida_audit
    AFTER INSERT OR UPDATE OR DELETE ON area_protegida
    FOR EACH ROW EXECUTE FUNCTION trg_auditar();
