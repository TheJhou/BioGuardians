import { useState } from 'react';
import MapView from '../components/MapView.js';
import DropdownSelect from '../components/DropdownSelect.js';
import SpeciesSearch from '../components/SpeciesSearch.js';
import { ESTADO_OPTIONS, FONTE_LABELS, FONTE_OPTIONS, CATEGORY_OPTIONS } from '../constants/index.js';

interface MapFilters {
  categoria?: string;   // threat category (CR/EN/VU...) — filtra ocorrências
  fonte?: string;       // filtra ocorrências
}

interface MapLayers {
  unidades: boolean;
  ocorrencias: boolean;
}

const defaultFilters: MapFilters = {};
const defaultLayers: MapLayers = { unidades: true, ocorrencias: true };

const fonteOptions = FONTE_OPTIONS.map((f) => ({ value: f, label: FONTE_LABELS[f] || f }));
const categoriaOptions = CATEGORY_OPTIONS.map((c) => ({ value: c.codigo, label: c.nome }));
const estadoOptions = ESTADO_OPTIONS.map((uf) => ({ value: uf, label: uf }));

export default function MapPage() {
  const [draft, setDraft] = useState<MapFilters>(defaultFilters);
  const [applied, setApplied] = useState<MapFilters>(defaultFilters);
  const [layers, setLayers] = useState<MapLayers>(defaultLayers);

  // Estado — renderizado mas ainda não filtra (pendente definição)
  const [estado] = useState<string | null>(null);

  const [selectedEspecieId, setSelectedEspecieId] = useState<number | null>(null);
  const [selectedEspecieName, setSelectedEspecieName] = useState<string | null>(null);

  const handleApply = () => {
    setApplied(draft);
  };

  const handleClear = () => {
    setDraft(defaultFilters);
    setApplied(defaultFilters);
    setLayers(defaultLayers);
    setSelectedEspecieId(null);
    setSelectedEspecieName(null);
  };

  // Chips aplicam na hora — sem depender do botão "Aplicar Filtros"
  const applyNow = (patch: Partial<MapFilters>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      setApplied(next);
      return next;
    });
  };

  return (
    <div className="map-page">
      <aside className="map-sidebar">
        <h3 className="sidebar-title">Filtros</h3>
        <button className="map-clear-btn" onClick={handleClear}>
          Limpar
        </button>

        {/* Estado — visual only for now */}
        <div className="filter-group">
          <label className="filter-label">Estado</label>
          <DropdownSelect
            options={estadoOptions}
            selected={estado}
            onSelect={() => {}}
            placeholder="Todos"
            disabled
          />
        </div>

        {/* Fonte */}
        <div className="filter-group">
          <label className="filter-label">Fonte</label>
          <DropdownSelect
            options={fonteOptions}
            selected={draft.fonte ?? null}
            onSelect={(v) => applyNow({ fonte: v ?? undefined })}
            placeholder="Todas"
          />
        </div>

        {/* Classificação (categoria de ameaça) */}
        <div className="filter-group">
          <label className="filter-label">Classificação</label>
          <DropdownSelect
            options={categoriaOptions}
            selected={draft.categoria ?? null}
            onSelect={(v) => applyNow({ categoria: v ?? undefined })}
            placeholder="Todas"
          />
        </div>

        {/* Buscar espécie — scroll infinito via API */}
        <div className="filter-group">
          <label className="filter-label">Buscar espécie</label>
          <SpeciesSearch
            onSelect={(s) => {
              setSelectedEspecieId(s.id);
              setSelectedEspecieName(s.nome_popular || s.nome_cientifico);
            }}
            selectedName={selectedEspecieName}
          />
        </div>

        {/* Esfera removida */}

        {/* Camadas */}
        <div className="filter-group">
          <label className="filter-label">Camadas</label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layers.unidades}
              onChange={(e) => setLayers({ ...layers, unidades: e.target.checked })}
            />
            Unidades de Conserva��o
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layers.ocorrencias}
              onChange={(e) => setLayers({ ...layers, ocorrencias: e.target.checked })}
            />
            Ocorr�ncias
          </label>
        </div>
        <button className="filter-apply" onClick={handleApply}>
          Aplicar Filtros
        </button>

        {/* Legenda */}
        <div className="map-legend">
          <h4>Legenda</h4>
          <div className="legend-section">
            <span className="legend-section-title">Unidades de Conservação</span>
            <div className="legend-item"><span className="legend-dot dot-uc-fed"></span> Federal</div>
            <div className="legend-item"><span className="legend-dot dot-uc-est"></span> Estadual</div>
            <div className="legend-item"><span className="legend-dot dot-uc-mun"></span> Municipal</div>
            <div className="legend-item"><span className="legend-dot dot-uc-part"></span> Particular</div>
          </div>
          <div className="legend-section">
            <span className="legend-section-title">Ocorrências por Categoria</span>
            <div className="legend-item"><span className="legend-dot" style={{ background: '#d32f2f' }}></span> CR — Criticamente em Perigo</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: '#f57c00' }}></span> EN — Entrando em Extinção</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: '#fbc02d' }}></span> VU — Alto Risco</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: '#689f38' }}></span> NT — Em Ameaça</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: '#388e3c' }}></span> LC — Sem Risco</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: '#757575' }}></span> DD — Sem Dados</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: '#90a4ae' }}></span> NE — Não Avaliada</div>
          </div>
        </div>
      </aside>

      <div className="map-wrapper">
        <MapView
          filters={applied}
          layers={layers}
          selectedEspecieId={selectedEspecieId}
        />
      </div>
    </div>
  );
}
