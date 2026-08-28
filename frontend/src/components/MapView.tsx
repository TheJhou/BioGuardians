import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GoogleMap, useJsApiLoader, Polygon, Marker, InfoWindow,
} from '@react-google-maps/api';
import { api } from '../api/client.js';
import { MAP_DEFAULTS, getCategoryColor, getUcCategoryColor } from '../constants/index.js';
import type {
  GeoJSONFeatureCollection, OcorrenciaProperties,
  EspecieEmArea,
} from '../types/index.js';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const containerStyle = { width: '100%', height: '100%' };
const center = MAP_DEFAULTS.center;
const zoom = MAP_DEFAULTS.zoom;

interface MapViewProps {
  filters: {
    categoria?: string;
    bioma?: number;
    estado?: string;
    busca?: string;
  };
  selectedEspecieId?: number | null;
}

export default function MapView({ filters, selectedEspecieId }: MapViewProps) {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  const [areas, setAreas] = useState<GeoJSONFeatureCollection | null>(null);
  const [ocorrencias, setOcorrencias] = useState<GeoJSONFeatureCollection<OcorrenciaProperties> | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [selectedAreaSpecies, setSelectedAreaSpecies] = useState<EspecieEmArea[]>([]);
  const [selectedOcorrencia, setSelectedOcorrencia] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  // Load areas (filtered by bioma if provided).
  const loadAreas = useCallback(async () => {
    try {
      const data = await api.getAreas({
        bioma: filters.bioma,
      });
      setAreas(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load areas');
    }
  }, [filters.bioma]);

  // Load occurrences (filtered by especie_id if selected).
  const loadOcorrencias = useCallback(async () => {
    try {
      const data = await api.getOcorrencias({
        especie_id: selectedEspecieId || undefined,
        limit: 500,
      });
      setOcorrencias(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load occurrences');
    }
  }, [selectedEspecieId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([loadAreas(), loadOcorrencias()])
      .finally(() => setLoading(false));
  }, [loadAreas, loadOcorrencias]);

  // Handle click on a protected area polygon.
  const handleAreaClick = async (areaId: number) => {
    setSelectedAreaId(areaId);
    setSelectedOcorrencia(null);
    try {
      const species = await api.getEspeciesEmArea(areaId);
      setSelectedAreaSpecies(species);
    } catch {
      setSelectedAreaSpecies([]);
    }
  };

  const onLoad = (map: google.maps.Map): void => {
    mapRef.current = map;
  };

  if (!isLoaded) {
    return <div className="map-loading">Loading Google Maps...</div>;
  }

  if (error) {
    return <div className="map-error">Error: {error}</div>;
  }

  return (
    <div className="map-container">
      {loading && <div className="map-overlay">Loading...</div>}
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={zoom}
        onLoad={onLoad}
        options={{
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        }}
      >
        {/* Protected area polygons */}
        {areas?.features.map((feature) => {
          if (feature.geometry.type !== 'Polygon') return null;
          const props = feature.properties as {
            nome: string; categoria_uc: string; esfera: string; area_ha: number;
          };
          const paths = feature.geometry.coordinates[0].map(
            ([lng, lat]) => ({ lat, lng })
          );
          const color = getUcCategoryColor(props.categoria_uc);
          return (
            <Polygon
              key={feature.id}
              paths={paths}
              options={{
                fillColor: color,
                fillOpacity: 0.3,
                strokeColor: color,
                strokeWeight: 2,
              }}
              onClick={() => handleAreaClick(feature.id!)}
            />
          );
        })}

        {/* Occurrence markers */}
        {ocorrencias?.features.map((feature) => {
          if (feature.geometry.type !== 'Point') return null;
          const [lng, lat] = feature.geometry.coordinates;
          const props = feature.properties;
          const color = getCategoryColor(props.categoria_ameaca);
          return (
            <Marker
              key={feature.id}
              position={{ lat, lng }}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 6,
                fillColor: color,
                fillOpacity: 1,
                strokeColor: '#fff',
                strokeWeight: 1,
              }}
              onClick={() => {
                setSelectedOcorrencia(feature.id!);
                setSelectedAreaId(null);
              }}
            />
          );
        })}

        {/* InfoWindow for selected area */}
        {selectedAreaId && (
          <InfoWindow
            position={(() => {
              const area = areas?.features.find((f) => f.id === selectedAreaId);
              if (area && area.geometry.type === 'Polygon') {
                const coords = area.geometry.coordinates[0];
                const avgLng = coords.reduce((s, [lng]) => s + lng, 0) / coords.length;
                const avgLat = coords.reduce((s, [, lat]) => s + lat, 0) / coords.length;
                return { lat: avgLat, lng: avgLng };
              }
              return center;
            })()}
            onCloseClick={() => setSelectedAreaId(null)}
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
                        {sp.categoria}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </InfoWindow>
        )}

        {/* InfoWindow for selected occurrence */}
        {selectedOcorrencia && (() => {
          const occ = ocorrencias?.features.find((f) => f.id === selectedOcorrencia);
          if (!occ || occ.geometry.type !== 'Point') return null;
          const [lng, lat] = occ.geometry.coordinates;
          const props = occ.properties;
          return (
            <InfoWindow
              position={{ lat, lng }}
              onCloseClick={() => setSelectedOcorrencia(null)}
            >
              <div className="info-window">
                <h4>{props.nome_cientifico}</h4>
                <p>
                  <span className={`cat-badge cat-${props.categoria_ameaca.toLowerCase()}`}>
                    {props.categoria_ameaca}
                  </span>
                </p>
                <p>Data: {props.data_evento || 'N/A'}</p>
                <p>Fonte: {props.fonte}</p>
                {props.base_registro && <p>Base: {props.base_registro}</p>}
                <p>Coords: {props.lat.toFixed(4)}, {props.lon.toFixed(4)}</p>
              </div>
            </InfoWindow>
          );
        })()}
      </GoogleMap>
    </div>
  );
}
