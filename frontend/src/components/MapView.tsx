import { useState, useCallback, useMemo } from 'react';
import { Map, Source, Layer, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../api/client.js';
import { MAP_DEFAULTS, CATEGORY_COLORS, UC_CATEGORY_COLORS } from '../constants/index.js';
import type { OcorrenciaProperties } from '../types/index.js';

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
  onSelectOcorrencia?: (ocorrencia: OcorrenciaProperties, lngLat: { lng: number; lat: number }) => void;
  onSelectArea?: (area: { id: number; nome: string }, lngLat: { lng: number; lat: number }) => void;
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

export default function MapView({
  filters,
  layers,
  selectedEspecieIds,
  onSelectOcorrencia,
  onSelectArea,
}: MapViewProps) {
  const [error, setError] = useState<string | null>(null);

  const areaTilesUrl = useMemo(
    () => api.getAreaTilesUrl({ esfera: filters.esfera }),
    [filters.esfera]
  );

  const ocorrenciasTilesUrl = useMemo(
    () => api.getOcorrenciasTilesUrl({
      especie_id: selectedEspecieIds,
      categoria: filters.categoria,
      fonte: filters.fonte,
    }),
    [selectedEspecieIds, filters.categoria, filters.fonte]
  );

  const handleClick = useCallback((evt: any) => {
    const features: any[] = evt.features || [];
    const areaFeature = features.find((f) => f.layer.id === 'areas-fill');
    const ocorrenciaFeature = features.find((f) => f.layer.id === 'ocorrencias-circle');
    const lngLat = evt.lngLat;
    const point = { lng: lngLat.lng, lat: lngLat.lat };

    if (ocorrenciaFeature && ocorrenciaFeature.properties && onSelectOcorrencia) {
      onSelectOcorrencia(ocorrenciaFeature.properties as OcorrenciaProperties, point);
    } else if (areaFeature && areaFeature.properties && onSelectArea) {
      onSelectArea(
        { id: areaFeature.properties.id as number, nome: areaFeature.properties.nome as string },
        point
      );
    }
  }, [onSelectOcorrencia, onSelectArea]);

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
        onError={(evt) => setError(String(evt.error?.message ?? evt.error) || 'Falha ao carregar o mapa. Verifique a chave do MapTiler.')}
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
      </Map>
    </div>
  );
}
