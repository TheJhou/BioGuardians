-- ============================================================
-- BioGuardians — 005: auditoria sem a geometria completa
--
-- trg_auditar gravava to_jsonb(OLD/NEW) inteiro. Em area_protegida isso
-- inclui o polígono (média ~1.1k vértices, picos de ~130k): o log_auditoria
-- chegou a 88 MB (metade do banco) e uma correção de nomes em 2.671 UCs
-- teria gravado mais ~244 MB só de geometria repetida.
--
-- Agora a coluna "geom" é trocada por "geom_md5" (hash do GeoJSON): ainda
-- dá para saber SE a geometria mudou, sem duplicar o polígono no log.
-- Tabelas sem geom (especie) não mudam. Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION trg_auditar()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_op  operacao_auditoria_tipo;
    v_id  BIGINT;
    v_old JSONB;
    v_new JSONB;
BEGIN
    v_op := TG_OP::operacao_auditoria_tipo;
    IF v_op = 'DELETE' THEN
        v_id := OLD.id;  v_old := to_jsonb(OLD); v_new := NULL;
    ELSIF v_op = 'UPDATE' THEN
        v_id := NEW.id;  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    ELSE
        v_id := NEW.id;  v_old := NULL;          v_new := to_jsonb(NEW);
    END IF;

    IF v_old ? 'geom' THEN
        v_old := (v_old - 'geom') || jsonb_build_object('geom_md5', md5(v_old->>'geom'));
    END IF;
    IF v_new ? 'geom' THEN
        v_new := (v_new - 'geom') || jsonb_build_object('geom_md5', md5(v_new->>'geom'));
    END IF;

    INSERT INTO log_auditoria (tabela, operacao, registro_id, dados_anteriores, dados_novos)
    VALUES (TG_TABLE_NAME, v_op, v_id, v_old, v_new);
    RETURN COALESCE(NEW, OLD);
END; $$;
