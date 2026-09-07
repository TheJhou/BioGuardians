import { useState, useCallback, useMemo } from 'react';
import { Map, Source, Layer, Popup, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../api/client.js';
import ImageWithSkeleton from './ImageWithSkeleton.js';
import { MAP_DEFAULTS, CATEGORY_LABELS, CATEGORY_COLORS, UC_CATEGORY_COLORS } from '../constants/index.js';
import type {
  OcorrenciaProperties,
  EspecieEmArea,
} from '../types/index.js';

const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY || '';

interface MapFilters {
  categoria?: string;
  esfera?: string;
  fonte?: string;
}

interface MapLayers {
  unidades: boolean;
  ocorrencias: boolean;
}

interface MapViewProps {
  filters: MapFilters;
  layers: MapLayers;
  selectedEspecieIds?: number[];
}

const INITIAL_VIEW = {
  longitude: MAP_DEFAULTS.center.lng,
  latitude: MAP_DEFAULTS.center.lat,
  zoom: MAP_DEFAULTS.zoom,
};

const occurrenceColorMatch = buildMatchExpression('categoria_ameaca', CATEGORY_COLORS, '#757575');
const ucColorMatch = buildMatchExpression('categoria_uc', UC_CATEGORY_COLORS, '#1565c0');

function buildMatchExpression(inputProperty: string, pairs: Record<string, string>, fallback: string): any[] {
  const stops = Object.entries(pairs).flatMap(([k, v]) => [k, v]);
  return ['match', ['get', inputProperty], ...stops, fallback];
}

export default function MapView({ filters, layers, selectedEspecieIds }: MapViewProps) {
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [selectedAreaSpecies, setSelectedAreaSpecies] = useState<EspecieEmArea[]>([]);
  const [selectedOcorrencia, setSelectedOcorrencia] = useState<OcorrenciaProperties | null>(null);
  const [popupLngLat, setPopupLngLat] = useState<{ lng: number; lat: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const areaTilesUrl = useMemo(
    () => api.getAreaTilesUrl({ esfera: filters.esfera, categoria: filters.categoria }),
    [filters.esfera, filters.categoria]
  );

  const ocorrenciasTilesUrl = useMemo(
    () => api.getOcorrenciasTilesUrl({
      especie_id: selectedEspecieIds,
      categoria: filters.categoria,
      fonte: filters.fonte,
    }),
    [selectedEspecieIds, filters.categoria, filters.fonte]
  );

  const handleClick = useCallback(async (evt: any) => {
    const features: any[] = evt.features || [];
    const areaFeature = features.find((f) => f.layer.id === 'areas-fill');
    const ocorrenciaFeature = features.find((f) => f.layer.id === 'ocorrencias-circle');
    const lngLat = evt.lngLat;

    if (ocorrenciaFeature && ocorrenciaFeature.properties) {
      setSelectedOcorrencia(ocorrenciaFeature.properties as OcorrenciaProperties);
      setSelectedAreaId(null);
      setPopupLngLat(lngLat);
    } else if (areaFeature && areaFeature.properties) {
      const areaId = areaFeature.properties.id as number;
      setSelectedAreaId(areaId);
      setSelectedOcorrencia(null);
      setPopupLngLat(lngLat);
      try {
        const species = await api.getEspeciesEmArea(areaId);
        setSelectedAreaSpecies(species);
      } catch {
        setSelectedAreaSpecies([]);
      }
    }
  }, []);

  const interactiveLayerIds = [
    ...(layers.unidades ? ['areas-fill'] : []),
    ...(layers.ocorrencias ? ['ocorrencias-circle'] : []),
  ];

  return (
    <div className="map-container" style={{ width: '100%', height: '100%' }}>
      {error && <div className="map-overlay map-error-inline">Erro: {error}</div>}

      <Map
        initialViewState={INITIAL_VIEW}
        style={{ width: '100%', height: '100%' }}
        mapStyle={`https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_API_KEY}`}
        onClick={handleClick}
        onError={(evt) => setError(String(evt.error) || 'Falha ao carregar o mapa. Verifique a chave do MapTiler.')}
        interactiveLayerIds={interactiveLayerIds}
      >
        <NavigationControl position="top-right" />

        {/* Protected area polygons (vector tiles) */}
        {layers.unidades && (
          <Source
            key={areaTilesUrl}
            id="areas"
            type="vector"
            tiles={[areaTilesUrl]}
            minzoom={0}
            maxzoom={14}
          >
            <Layer
              id="areas-fill"
              type="fill"
              source-layer="uc"
              paint={{ 'fill-color': ucColorMatch as any, 'fill-opacity': 0.3 }}
            />
            <Layer
              id="areas-line"
              type="line"
              source-layer="uc"
              paint={{ 'line-color': ucColorMatch as any, 'line-width': 2 }}
            />
          </Source>
        )}

        {/* Occurrence markers (vector tiles) */}
        {layers.ocorrencias && (
          <Source
            key={ocorrenciasTilesUrl}
            id="ocorrencias"
            type="vector"
            tiles={[ocorrenciasTilesUrl]}
            minzoom={0}
            maxzoom={14}
          >
            <Layer
              id="ocorrencias-circle"
              type="circle"
              source-layer="ocorrencia"
              paint={{
                'circle-color': occurrenceColorMatch as any,
                'circle-radius': 6,
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 1,
              }}
            />
          </Source>
        )}

        {/* Popup for selected area */}
        {popupLngLat && selectedAreaId && (
          <Popup
            longitude={popupLngLat.lng}
            latitude={popupLngLat.lat}
            anchor="top"
            offset={16}
            maxWidth="320px"
            onClose={() => { setSelectedAreaId(null); setPopupLngLat(null); }}
            closeButton
          >
            <div className="info-window">
              <h4>Especies protegidas nesta UC</h4>
              {selectedAreaSpecies.length === 0 ? (
                <p>Nenhuma especie ameacada encontrada.</p>
              ) : (
                <ul>
                  {selectedAreaSpecies.map((sp) => (
                    <li key={sp.especie_id}>
                      <strong>{sp.nome_cientifico}</strong>
                      {sp.nome_popular && ` (${sp.nome_popular})`}
                      <span className={`cat-badge cat-${sp.categoria.toLowerCase()}`}>
                        {CATEGORY_LABELS[sp.categoria] || sp.categoria}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Popup>
        )}

        {/* Popup for selected occurrence */}
        {popupLngLat && selectedOcorrencia && (
          <Popup
            longitude={popupLngLat.lng}
            latitude={popupLngLat.lat}
            anchor="bottom"
            offset={16}
            maxWidth="360px"
            onClose={() => { setSelectedOcorrencia(null); setPopupLngLat(null); }}
            closeButton
          >
            <div className="occurrence-popup">
              <div className="occurrence-image">
                {selectedOcorrencia.imagem_url ? (
                  <ImageWithSkeleton
                    src={selectedOcorrencia.imagem_url || undefined}
                    alt={selectedOcorrencia.nome_cientifico}
                    className="occurrence-detail-img"
                    skeletonClassName="occurrence-image-skeleton"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0z" />
                    <path d="M17.8 9.6c1.4 2.2 2.2 4.8 2.2 7.4 0 1.3-.4 2.5-1 3.5" />
                    <path d="M4 17c0-2.6.8-5.2 2.2-7.4" />
                    <path d="M12 19l4 2-3-6" />
                  </svg>
                )}
              </div>
              <div className="occurrence-body">
                <h4>{selectedOcorrencia.nome_popular || selectedOcorrencia.nome_cientifico}</h4>
                <p className="occurrence-scientific">{selectedOcorrencia.nome_cientifico}</p>
                <span className={`cat-badge cat-${selectedOcorrencia.categoria_ameaca.toLowerCase()}`}>
                  {CATEGORY_LABELS[selectedOcorrencia.categoria_ameaca] || selectedOcorrencia.categoria_ameaca}
                </span>
                <div className="occurrence-meta">
                  <p><strong>Data:</strong> {selectedOcorrencia.data_evento || 'N/A'}</p>
                  <p><strong>Fonte:</strong> {selectedOcorrencia.fonte}</p>
                  {selectedOcorrencia.confianca_ia != null && (
                    <p><strong>Confian�a da IA:</strong> {Math.round(selectedOcorrencia.confianca_ia * 100)}%</p>
                  )}
                  {selectedOcorrencia.base_registro && (
                    <p><strong>Base:</strong> {selectedOcorrencia.base_registro}</p>
                  )}
                  <p className="occurrence-coords">
                    {selectedOcorrencia.lat.toFixed(4)},{' '}
                    {selectedOcorrencia.lon.toFixed(4)}
                  </p>
                </div>
              </div>
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
