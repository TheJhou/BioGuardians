import { useState, useEffect, useCallback, useMemo } from 'react';
import Header from '../components/layout/Header.js';
import MapView from '../components/MapView.js';
import OccurrencePanel from '../components/OccurrencePanel.js';
import AreaPanel from '../components/AreaPanel.js';
import DropdownSelect from '../components/DropdownSelect.js';
import SpeciesSearch from '../components/SpeciesSearch.js';
import GlowButton from '../components/GlowButton.js';
import CosmicToggle from '../components/CosmicToggle.js';
import { FONTE_LABELS, FONTE_OPTIONS, CATEGORY_OPTIONS } from '../constants/index.js';
import { api } from '../api/client.js';
import type { Especie, OcorrenciaProperties, EspecieEmArea } from '../types/index.js';

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

function MapLegend() {
  return (
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
  );
}

export default function MapPage() {
  const [draft, setDraft] = useState<MapFilters>(defaultFilters);
  const [applied, setApplied] = useState<MapFilters>(defaultFilters);
  const [layers, setLayers] = useState<MapLayers>(defaultLayers);
  const [showFilters, setShowFilters] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  // Multi-seleção de espécies
  const [selectedEspecies, setSelectedEspecies] = useState<SelectedEspecie[]>([]);
  const [searchResetKey, setSearchResetKey] = useState(0);

  // Painéis inferiores
  const [selectedOcorrencia, setSelectedOcorrencia] = useState<OcorrenciaProperties | null>(null);
  const [selectedArea, setSelectedArea] = useState<{ id: number; nome: string } | null>(null);
  const [selectedAreaSpecies, setSelectedAreaSpecies] = useState<EspecieEmArea[]>([]);

  useEffect(() => {
    if (!selectedArea) {
      setSelectedAreaSpecies([]);
      return;
    }
    api.getEspeciesEmArea(selectedArea.id)
      .then(setSelectedAreaSpecies)
      .catch(() => setSelectedAreaSpecies([]));
  }, [selectedArea]);

  const handleClear = () => {
    setDraft(defaultFilters);
    setApplied(defaultFilters);
    setLayers(defaultLayers);
    setSelectedEspecies([]);
    setSelectedOcorrencia(null);
    setSelectedArea(null);
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

  const handleSelectOcorrencia = useCallback((ocorrencia: OcorrenciaProperties) => {
    setSelectedArea(null);
    setSelectedOcorrencia(ocorrencia);
  }, []);

  const handleSelectArea = useCallback((area: { id: number; nome: string }) => {
    setSelectedOcorrencia(null);
    setSelectedArea(area);
  }, []);

  const selectedEspecieIds = useMemo(
    () => selectedEspecies.map((e) => e.id),
    [selectedEspecies]
  );

  return (
    <div className="map-page">
      <Header />

      <div className="map-content">
        <aside className={`map-sidebar ${showFilters ? 'map-sidebar--open' : ''}`}>
          <h3 className="sidebar-title">Filtros</h3>

          {/* Buscar espécie — multi-seleção com chips removíveis */}
          <div className="filter-group filter-group--full">
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

          {/* Fonte e Classificação na mesma linha */}
          <div className="filter-row">
            <div className="filter-group">
              <label className="filter-label">Fonte</label>
              <DropdownSelect
                options={fonteOptions}
                selected={draft.fonte ?? null}
                onSelect={(v) => applyNow({ fonte: v ?? undefined })}
                placeholder="Todas"
              />
            </div>
            <div className="filter-group">
              <label className="filter-label">Classificação</label>
              <DropdownSelect
                options={categoriaOptions}
                selected={draft.categoria ?? null}
                onSelect={(v) => applyNow({ categoria: v ?? undefined })}
                placeholder="Todas"
              />
            </div>
          </div>

          {/* Camadas — toggles do tipo chave na mesma linha */}
          <div className="filter-group filter-group--full">
            <label className="filter-label">Camadas</label>
            <div className="toggle-row">
              <div className="toggle-item">
                <span className="toggle-text">Unidades de Conservação</span>
                <CosmicToggle
                  checked={layers.unidades}
                  onChange={(v) => setLayers({ ...layers, unidades: v })}
                />
              </div>
              <div className="toggle-item">
                <span className="toggle-text">Ocorrências</span>
                <CosmicToggle
                  checked={layers.ocorrencias}
                  onChange={(v) => setLayers({ ...layers, ocorrencias: v })}
                />
              </div>
            </div>
          </div>

          <GlowButton className="map-clear-btn" onClick={handleClear}>
            Limpar
          </GlowButton>

          <MapLegend />
        </aside>

        <div className="map-filters-bar">
          <button
            className={`map-filters-toggle ${showFilters ? 'active' : ''}`}
            type="button"
            onClick={() => { setShowFilters((s) => !s); setShowLegend(false); }}
          >
            {showFilters ? 'Sair' : 'Ver filtros'}
          </button>
          <button
            className={`map-legend-toggle ${showLegend ? 'active' : ''}`}
            type="button"
            onClick={() => { setShowLegend((s) => !s); setShowFilters(false); }}
          >
            {showLegend ? 'Sair' : 'Ver legenda'}
          </button>
        </div>

        <div className={`map-legend-panel ${showLegend ? 'map-legend-panel--open' : ''}`}>
          <MapLegend />
        </div>

        <div className="map-wrapper">
          <MapView
            filters={applied}
            layers={layers}
            selectedEspecieIds={selectedEspecieIds}
            onSelectOcorrencia={handleSelectOcorrencia}
            onSelectArea={handleSelectArea}
          />

          {selectedOcorrencia && (
            <OccurrencePanel
              ocorrencia={selectedOcorrencia}
              onClose={() => setSelectedOcorrencia(null)}
            />
          )}

          {selectedArea && (
            <AreaPanel
              areaId={selectedArea.id}
              areaName={selectedArea.nome}
              species={selectedAreaSpecies}
              onClose={() => {
                setSelectedArea(null);
                setSelectedAreaSpecies([]);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
