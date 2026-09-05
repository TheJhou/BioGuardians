import { useState, useEffect, useCallback, useRef } from 'react';
import { Map, Source, Layer, Popup, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../api/client.js';
import ImageWithSkeleton from './ImageWithSkeleton.js';
import { MAP_DEFAULTS, getCategoryColor, getUcCategoryColor } from '../constants/index.js';
import { CATEGORY_LABELS } from '../constants/index.js';
import type {
  GeoJSONFeatureCollection, OcorrenciaProperties,
  EspecieEmArea, GeoJSONFeature, GeoJSONPoint, GeoJSONPolygon,
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
  selectedEspecieId?: number | null;
}

// Debounce hook: delays calling a function until after wait ms of inactivity.
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
}

// Convert lat/lng center object to react-map-gl initial view.
const INITIAL_VIEW = {
  longitude: MAP_DEFAULTS.center.lng,
  latitude: MAP_DEFAULTS.center.lat,
  zoom: MAP_DEFAULTS.zoom,
};

const DEFAULT_BBOX = `${MAP_DEFAULTS.center.lng - 20},${MAP_DEFAULTS.center.lat - 20},${MAP_DEFAULTS.center.lng + 20},${MAP_DEFAULTS.center.lat + 20}`;

function getViewport(map: any) {
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const center = map.getCenter();
  const coordinate = (value: number) => value.toFixed(5);
  return {
    bbox: `${coordinate(sw.lng)},${coordinate(sw.lat)},${coordinate(ne.lng)},${coordinate(ne.lat)}`,
    zoom: Number(map.getZoom().toFixed(2)),
    longitude: center.lng,
    latitude: center.lat,
  };
}

export default function MapView({ filters, layers, selectedEspecieId }: MapViewProps) {
  const [areas, setAreas] = useState<GeoJSONFeatureCollection | null>(null);
  const [ocorrencias, setOcorrencias] = useState<GeoJSONFeatureCollection<OcorrenciaProperties> | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [selectedAreaSpecies, setSelectedAreaSpecies] = useState<EspecieEmArea[]>([]);
  const [selectedOcorrencia, setSelectedOcorrencia] = useState<GeoJSONFeature<OcorrenciaProperties> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingAreas, setLoadingAreas] = useState(false);
  const [loadingOccurrences, setLoadingOccurrences] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Viewport state (bbox + zoom) updated when map stops moving.
  const [viewport, setViewport] = useState({
    bbox: DEFAULT_BBOX,
    zoom: MAP_DEFAULTS.zoom,
    longitude: INITIAL_VIEW.longitude,
    latitude: INITIAL_VIEW.latitude,
  });
  const debouncedViewport = useDebounce(viewport, 500);
  const mapRef = useRef<any>(null);
  const areaRequestId = useRef(0);
  const occurrenceRequestId = useRef(0);
  const showOccurrenceData = layers.ocorrencias;

  const handleMoveEnd = useCallback((evt: any) => {
    setViewport(getViewport(evt.target));
  }, []);

  const handleLoad = useCallback((evt: any) => {
    setLoading(false);
    const map = evt.target;
    setTimeout(() => {
      if (map.resize) map.resize();
    }, 150);
    setViewport(getViewport(map));
  }, []);

  // Load areas (filtered by viewport + filters).
  const loadAreas = useCallback(async () => {
    const requestId = ++areaRequestId.current;
    setLoadingAreas(true);
    setError(null);
    try {
      const data = await api.getAreas({
        esfera: filters.esfera,
        bbox: debouncedViewport.bbox,
        zoom: debouncedViewport.zoom,
      });
      // Enrich features with color for the map layer.
      const colored = {
        ...data,
        features: data.features.map((feature) => {
          const props = feature.properties as { categoria_uc?: string };
          return {
            ...feature,
            properties: {
              ...props,
              color: getUcCategoryColor(props.categoria_uc ?? ''),
            },
          };
        }),
      };
      if (requestId === areaRequestId.current) setAreas(colored as GeoJSONFeatureCollection);
    } catch (err) {
      if (requestId === areaRequestId.current) setError(err instanceof Error ? err.message : 'Failed to load areas');
    } finally {
      if (requestId === areaRequestId.current) setLoadingAreas(false);
    }
  }, [filters.esfera, debouncedViewport.bbox, debouncedViewport.zoom]);

  // Load occurrences (filtered by viewport + filters).
  const loadOcorrencias = useCallback(async () => {
    const requestId = ++occurrenceRequestId.current;
    setLoadingOccurrences(true);
    setError(null);
    try {
      const data = await api.getOcorrencias({
        especie_id: selectedEspecieId || undefined,
        categoria: filters.categoria,
        fonte: filters.fonte,
        bbox: debouncedViewport.bbox,
        limit: 10000,
      });
      const colored = {
        ...data,
        features: data.features.map((feature) => {
          const props = feature.properties as OcorrenciaProperties;
          return {
            ...feature,
            properties: {
              ...props,
              color: getCategoryColor(props.categoria_ameaca),
            },
          };
        }),
      };
      if (requestId === occurrenceRequestId.current) setOcorrencias(colored as GeoJSONFeatureCollection<OcorrenciaProperties>);
    } catch (err) {
      if (requestId === occurrenceRequestId.current) setError(err instanceof Error ? err.message : 'Failed to load occurrences');
    } finally {
      if (requestId === occurrenceRequestId.current) setLoadingOccurrences(false);
    }
  }, [selectedEspecieId, filters.categoria, filters.fonte, debouncedViewport.bbox]);

  useEffect(() => {
    if (!debouncedViewport.bbox || !layers.unidades) {
      areaRequestId.current += 1;
      setLoadingAreas(false);
      return;
    }
    void loadAreas();
  }, [loadAreas, layers.unidades, debouncedViewport.bbox]);

  useEffect(() => {
    if (!debouncedViewport.bbox || !showOccurrenceData) {
      occurrenceRequestId.current += 1;
      setLoadingOccurrences(false);
      return;
    }
    void loadOcorrencias();
  }, [loadOcorrencias, showOccurrenceData, debouncedViewport.bbox]);

  // Handle click on an occurrence point or protected area polygon.
  // Occurrence points take priority — they sit on top of area polygons.
  const handleClick = async (evt: any) => {
    const features: any[] = evt.features || [];
    const areaFeature = features.find((f) => f.layer.id === 'areas-fill');
    const ocorrenciaFeature = features.find((f) => f.layer.id === 'ocorrencias-circle');

    if (ocorrenciaFeature) {
      setSelectedOcorrencia(ocorrenciaFeature as unknown as GeoJSONFeature<OcorrenciaProperties>);
      setSelectedAreaId(null);
    } else if (areaFeature) {
      const areaId = areaFeature.properties.id as number;
      setSelectedAreaId(areaId);
      setSelectedOcorrencia(null);
      try {
        const species = await api.getEspeciesEmArea(areaId);
        setSelectedAreaSpecies(species);
      } catch {
        setSelectedAreaSpecies([]);
      }
    }
  };

  // Compute popup position for selected area (centroid of polygon).
  const areaPopupPosition = (() => {
    if (!selectedAreaId || !areas) return null;
    const area = areas.features.find((f) => f.id === selectedAreaId);
    if (!area || area.geometry.type !== 'Polygon') return null;
    const coords = (area.geometry as GeoJSONPolygon).coordinates[0];
    const avgLng = coords.reduce((s, [lng]) => s + lng, 0) / coords.length;
    const avgLat = coords.reduce((s, [, lat]) => s + lat, 0) / coords.length;
    return { longitude: avgLng, latitude: avgLat };
  })();

  const occurrencePopupPosition = (() => {
    if (!selectedOcorrencia || selectedOcorrencia.geometry.type !== 'Point') return null;
    const [lng, lat] = (selectedOcorrencia.geometry as GeoJSONPoint).coordinates;
    return { longitude: lng, latitude: lat };
  })();

  return (
    <div className="map-container" style={{ width: '100%', height: '100%' }}>
      {error && <div className="map-overlay map-error-inline">Erro: {error}</div>}
      {(loading || loadingAreas || loadingOccurrences) && !error && <div className="map-overlay">Carregando mapa...</div>}
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        style={{ width: '100%', height: '100%' }}
        mapStyle={`https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_API_KEY}`}
        onLoad={handleLoad}
        onMoveEnd={handleMoveEnd}
        onClick={handleClick}
        onError={(evt) => setError(String(evt.error) || 'Falha ao carregar o mapa. Verifique a chave do MapTiler.')}
        interactiveLayerIds={[
          ...(layers.unidades ? ['areas-fill'] : []),
          ...(layers.ocorrencias ? ['ocorrencias-circle'] : []),
        ]}
      >
        <NavigationControl position="top-right" />

        {/* Protected area polygons */}
        {layers.unidades && areas && (
          <Source id="areas" type="geojson" data={areas}>
            <Layer
              id="areas-fill"
              type="fill"
              paint={{
                'fill-color': ['get', 'color'],
                'fill-opacity': 0.3,
              }}
            />
            <Layer
              id="areas-line"
              type="line"
              paint={{
                'line-color': ['get', 'color'],
                'line-width': 2,
              }}
            />
          </Source>
        )}

        {/* Occurrence markers */}
        {layers.ocorrencias && ocorrencias && (
          <Source id="ocorrencias" type="geojson" data={ocorrencias}>
            <Layer
              id="ocorrencias-circle"
              type="circle"
              paint={{
                'circle-color': ['get', 'color'],
                'circle-radius': 6,
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 1,
              }}
            />
          </Source>
        )}

        {/* Popup for selected area */}
        {areaPopupPosition && (
          <Popup
            longitude={areaPopupPosition.longitude}
            latitude={areaPopupPosition.latitude}
            anchor="top"
            offset={16}
            dynamicPosition
            maxWidth="320px"
            onClose={() => setSelectedAreaId(null)}
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
        {occurrencePopupPosition && selectedOcorrencia && (
          <Popup
            longitude={occurrencePopupPosition.longitude}
            latitude={occurrencePopupPosition.latitude}
            anchor="bottom"
            offset={16}
            dynamicPosition
            maxWidth="360px"
            onClose={() => setSelectedOcorrencia(null)}
            closeButton
          >
            <div className="occurrence-popup">
              <div className="occurrence-image">
                {selectedOcorrencia.properties.imagem_url ? (
                  <ImageWithSkeleton
                    src={selectedOcorrencia.properties.imagem_url}
                    alt={selectedOcorrencia.properties.nome_cientifico}
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
                <h4>{selectedOcorrencia.properties.nome_popular || selectedOcorrencia.properties.nome_cientifico}</h4>
                <p className="occurrence-scientific">{selectedOcorrencia.properties.nome_cientifico}</p>
                <span className={`cat-badge cat-${selectedOcorrencia.properties.categoria_ameaca.toLowerCase()}`}>
                  {CATEGORY_LABELS[selectedOcorrencia.properties.categoria_ameaca] || selectedOcorrencia.properties.categoria_ameaca}
                </span>
                <div className="occurrence-meta">
                  <p><strong>Data:</strong> {selectedOcorrencia.properties.data_evento || 'N/A'}</p>
                  <p><strong>Fonte:</strong> {selectedOcorrencia.properties.fonte}</p>
                  {selectedOcorrencia.properties.confianca_ia != null && (
                    <p><strong>Confiança da IA:</strong> {Math.round(selectedOcorrencia.properties.confianca_ia * 100)}%</p>
                  )}
                  {selectedOcorrencia.properties.base_registro && (
                    <p><strong>Base:</strong> {selectedOcorrencia.properties.base_registro}</p>
                  )}
                  <p className="occurrence-coords">
                    {selectedOcorrencia.properties.lat.toFixed(4)},{' '}
                    {selectedOcorrencia.properties.lon.toFixed(4)}
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
