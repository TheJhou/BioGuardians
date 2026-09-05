import { useState } from 'react';
import MapView from '../components/MapView.js';
import DropdownSelect from '../components/DropdownSelect.js';
import SpeciesSearch from '../components/SpeciesSearch.js';
import { ESTADO_OPTIONS, FONTE_LABELS, FONTE_OPTIONS, CATEGORY_OPTIONS } from '../constants/index.js';
import type { Especie } from '../types/index.js';

interface MapFilters {
  categoria?: string;
  fonte?: string;
}

interface MapLayers {
  unidades: boolean;
  ocorrencias: boolean;
}

interface SelectedEspecie {
  id: number;
  nome: string;
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

  // Multi-seleção de espécies
  const [selectedEspecies, setSelectedEspecies] = useState<SelectedEspecie[]>([]);
  const [searchResetKey, setSearchResetKey] = useState(0);

  const handleApply = () => {
    setApplied(draft);
  };

  const handleClear = () => {
    setDraft(defaultFilters);
    setApplied(defaultFilters);
    setLayers(defaultLayers);
    setSelectedEspecies([]);
    setSearchResetKey((k) => k + 1);
  };

  // Chips aplicam na hora — sem depender do botão "Aplicar Filtros"
  const applyNow = (patch: Partial<MapFilters>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      setApplied(next);
      return next;
    });
  };

  const addEspecie = (especie: Especie) => {
    setSelectedEspecies((prev) => {
      if (prev.some((e) => e.id === especie.id)) return prev;
      return [...prev, { id: especie.id, nome: especie.nome_popular || especie.nome_cientifico }];
    });
  };

  const removeEspecie = (id: number) => {
    setSelectedEspecies((prev) => prev.filter((e) => e.id !== id));
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

        {/* Buscar espécie — multi-seleção com chips removíveis */}
        <div className="filter-group">
          <label className="filter-label">Buscar espécie</label>
          <SpeciesSearch
            key={searchResetKey}
            onSelect={addEspecie}
          />
          {selectedEspecies.length > 0 && (
            <div className="selected-species-chips">
              {selectedEspecies.map((e) => (
                <span key={e.id} className="species-chip">
                  {e.nome}
                  <button
                    className="species-chip-remove"
                    onClick={() => removeEspecie(e.id)}
                    aria-label={`Remover ${e.nome}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Camadas */}
        <div className="filter-group">
          <label className="filter-label">Camadas</label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layers.unidades}
              onChange={(e) => setLayers({ ...layers, unidades: e.target.checked })}
            />
            Unidades de Conservação
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layers.ocorrencias}
              onChange={(e) => setLayers({ ...layers, ocorrencias: e.target.checked })}
            />
            Ocorrências
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
          selectedEspecieIds={selectedEspecies.map((e) => e.id)}
        />
      </div>
    </div>
  );
}
