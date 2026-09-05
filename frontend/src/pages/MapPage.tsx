import { useState, useEffect, useRef } from 'react';
import MapView from '../components/MapView.js';
import DropdownSelect from '../components/DropdownSelect.js';
import { api } from '../api/client.js';
import { ESTADO_OPTIONS, FONTE_LABELS, FONTE_OPTIONS, CATEGORY_OPTIONS, SPHERE_OPTIONS } from '../constants/index.js';
import type { Especie } from '../types/index.js';

interface MapFilters {
  esfera?: string;
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

  const [speciesSearch, setSpeciesSearch] = useState('');
  const [speciesResults, setSpeciesResults] = useState<Especie[]>([]);
  const [selectedEspecieId, setSelectedEspecieId] = useState<number | null>(null);
  const [selectedEspecieName, setSelectedEspecieName] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleApply = () => {
    setApplied(draft);
  };

  const handleClear = () => {
    setDraft(defaultFilters);
    setApplied(defaultFilters);
    setLayers(defaultLayers);
    setSpeciesSearch('');
    setSpeciesResults([]);
    setSelectedEspecieId(null);
    setSelectedEspecieName(null);
  };

  const updateDraft = (patch: Partial<MapFilters>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  // Chips aplicam na hora — sem depender do botão "Aplicar Filtros"
  const applyNow = (patch: Partial<MapFilters>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      setApplied(next);
      return next;
    });
  };

  const handleSpeciesInputChange = (value: string) => {
    setSpeciesSearch(value);
    setSelectedEspecieId(null);
    setSelectedEspecieName(null);
    setSpeciesResults([]);

    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!value.trim()) return;

    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.getEspecies({ busca: value, per_page: 10 });
        setSpeciesResults(res.data as Especie[]);
      } catch {
        setSpeciesResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  };

  const selectEspecie = (especie: Especie) => {
    setSelectedEspecieId(especie.id);
    setSelectedEspecieName(especie.nome_popular || especie.nome_cientifico);
    setSpeciesSearch(especie.nome_popular || especie.nome_cientifico);
    setSpeciesResults([]);
  };

  useEffect(() => {
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, []);

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

        {/* Buscar espécie */}
        <div className="filter-group" style={{ position: 'relative' }}>
          <label className="filter-label">Buscar espécie</label>
          <input
            type="text"
            className="filter-input"
            placeholder="Ex: onça, arara, jacaré..."
            value={speciesSearch}
            onChange={(e) => handleSpeciesInputChange(e.target.value)}
          />
          {searching && <span className="species-search-hint">Buscando...</span>}
          {speciesResults.length > 0 && (
            <ul className="species-search-results">
              {speciesResults.map((s) => (
                <li
                  key={s.id}
                  className="species-search-item"
                  onClick={() => selectEspecie(s)}
                >
                  <strong>{s.nome_popular || s.nome_cientifico}</strong>
                  <span className="species-search-scientific">{s.nome_cientifico}</span>
                </li>
              ))}
            </ul>
          )}
          {selectedEspecieId && (
            <div className="species-selected">
              Filtrando por: <strong>{selectedEspecieName}</strong>
            </div>
          )}
        </div>

        {/* Esfera — afeta só UCs */}
        <div className="filter-group">
          <label className="filter-label">Esfera (UCs)</label>
          <select
            className="filter-select"
            value={draft.esfera || ''}
            onChange={(e) => updateDraft({ esfera: e.target.value || undefined })}
          >
            <option value="">Todas</option>
            {SPHERE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.nome}</option>
            ))}
          </select>
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
          selectedEspecieId={selectedEspecieId}
        />
      </div>
    </div>
  );
}
