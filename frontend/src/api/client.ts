import type {
  Bioma, Estado, Categoria, Taxon, Especie, EspecieBusca,
  GeoJSONFeatureCollection, OcorrenciaProperties, DashboardData,
  EspecieEmArea, AreaProtegeEspecie, PaginatedResponse,
} from '../types/index.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Simple in-memory cache to avoid refetching the same data.
const responseCache = new Map<string, { data: unknown; ts: number }>();
const pendingRequests = new Map<string, Promise<unknown>>();
const CACHE_TTL = 30_000; // 30s
const CACHE_MAX_ENTRIES = 100;

function getCached<T>(key: string): T | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts >= CACHE_TTL) {
    responseCache.delete(key);
    return null;
  }
  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry.data as T;
}

function setCached(key: string, data: unknown): void {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.delete(key);
  responseCache.set(key, { data, ts: Date.now() });
}

function fetchCached<T>(key: string, path: string): Promise<T> {
  const cached = getCached<T>(key);
  if (cached) return Promise.resolve(cached);
  const pending = pendingRequests.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const request = fetchApi<T>(path)
    .then((data) => {
      setCached(key, data);
      return data;
    })
    .finally(() => pendingRequests.delete(key));
  pendingRequests.set(key, request);
  return request;
}

function fetchDeduplicated<T>(path: string): Promise<T> {
  const pending = pendingRequests.get(path) as Promise<T> | undefined;
  if (pending) return pending;
  const request = fetchApi<T>(path).finally(() => pendingRequests.delete(path));
  pendingRequests.set(path, request);
  return request;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// --- Reference data (cached client-side) ---
export const api = {
  // Biomas
  async getBiomas(): Promise<Bioma[]> {
    const cached = getCached<Bioma[]>('biomas');
    if (cached) return cached;
    const data = await fetchApi<Bioma[]>('/biomas');
    setCached('biomas', data);
    return data;
  },

  // Estados
  async getEstados(): Promise<Estado[]> {
    const cached = getCached<Estado[]>('estados');
    if (cached) return cached;
    const data = await fetchApi<Estado[]>('/estados');
    setCached('estados', data);
    return data;
  },

  // Categorias
  async getCategorias(): Promise<Categoria[]> {
    const cached = getCached<Categoria[]>('categorias');
    if (cached) return cached;
    const data = await fetchApi<Categoria[]>('/categorias');
    setCached('categorias', data);
    return data;
  },

  // Taxonomia
  async getTaxonomia(rank?: string): Promise<Taxon[]> {
    const path = rank ? `/taxonomia?rank=${encodeURIComponent(rank)}` : '/taxonomia';
    return fetchApi<Taxon[]>(path);
  },

  // Especies
  async getEspecies(params?: {
    categoria?: string; bioma?: number; estado?: string; status?: string; busca?: string;
    page?: number; per_page?: number;
  }): Promise<PaginatedResponse<Especie | EspecieBusca>> {
    const qs = new URLSearchParams();
    if (params?.categoria) qs.set('categoria', params.categoria);
    if (params?.bioma) qs.set('bioma', String(params.bioma));
    if (params?.estado) qs.set('estado', params.estado);
    if (params?.status) qs.set('status', params.status);
    if (params?.busca) qs.set('busca', params.busca);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.per_page) qs.set('per_page', String(params.per_page));
    const query = qs.toString();
    return fetchApi<PaginatedResponse<Especie | EspecieBusca>>(`/especies${query ? `?${query}` : ''}`);
  },

  async getEspecie(id: number): Promise<Especie> {
    return fetchApi<Especie>(`/especies/${id}`);
  },

  async getEspecieOcorrencias(id: number, params?: { page?: number; per_page?: number }): Promise<PaginatedResponse<OcorrenciaProperties>> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.per_page) qs.set('per_page', String(params.per_page));
    const query = qs.toString();
    return fetchApi<PaginatedResponse<OcorrenciaProperties>>(`/especies/${id}/ocorrencias${query ? `?${query}` : ''}`);
  },

  async createEspecie(data: {
    nome_cientifico: string; nome_popular?: string; categoria_ameaca: string;
    genero_id: number; descricao?: string; biomas?: number[]; estados?: string[];
  }): Promise<{ id: number }> {
    return fetchApi<{ id: number }>('/especies', {
      method: 'POST', body: JSON.stringify(data),
    });
  },

  async updateEspecie(id: number, data: Partial<{
    nome_cientifico: string; nome_popular: string; categoria_ameaca: string;
    genero_id: number; descricao: string; status: string;
  }>): Promise<{ message: string }> {
    return fetchApi<{ message: string }>(`/especies/${id}`, {
      method: 'PUT', body: JSON.stringify(data),
    });
  },

  async deleteEspecie(id: number): Promise<{ message: string }> {
    return fetchApi<{ message: string }>(`/especies/${id}`, { method: 'DELETE' });
  },

  async getAreasProtegemEspecie(id: number): Promise<AreaProtegeEspecie[]> {
    return fetchApi<AreaProtegeEspecie[]>(`/especies/${id}/areas-protegidas`);
  },

  // Areas
  async getAreas(params?: {
    bioma?: number; esfera?: string; categoria?: string; busca?: string;
    bbox?: string; zoom?: number;
  }): Promise<GeoJSONFeatureCollection> {
    const qs = new URLSearchParams();
    if (params?.bioma) qs.set('bioma', String(params.bioma));
    if (params?.esfera) qs.set('esfera', params.esfera);
    if (params?.categoria) qs.set('categoria', params.categoria);
    if (params?.busca) qs.set('busca', params.busca);
    if (params?.bbox) qs.set('bbox', params.bbox);
    if (params?.zoom) qs.set('zoom', String(params.zoom));
    const query = qs.toString();
    const path = `/areas${query ? `?${query}` : ''}`;
    return fetchDeduplicated<GeoJSONFeatureCollection>(path);
  },

  async getArea(id: number): Promise<GeoJSONFeatureCollection> {
    return fetchApi<GeoJSONFeatureCollection>(`/areas/${id}`);
  },

  async getEspeciesEmArea(id: number): Promise<EspecieEmArea[]> {
    return fetchApi<EspecieEmArea[]>(`/areas/${id}/especies`);
  },

  async createArea(data: {
    nome: string; categoria_uc: string; esfera: string;
    bioma_id?: number; area_ha?: number; geojson: unknown;
  }): Promise<{ id: number }> {
    return fetchApi<{ id: number }>('/areas', {
      method: 'POST', body: JSON.stringify(data),
    });
  },

  async updateArea(id: number, data: Record<string, unknown>): Promise<{ message: string }> {
    return fetchApi<{ message: string }>(`/areas/${id}`, {
      method: 'PUT', body: JSON.stringify(data),
    });
  },

  async deleteArea(id: number): Promise<{ message: string }> {
    return fetchApi<{ message: string }>(`/areas/${id}`, { method: 'DELETE' });
  },

  // Ocorrencias
  async getOcorrencias(params?: {
    especie_id?: number; categoria?: string; bioma?: number; fonte?: string; limit?: number; bbox?: string;
  }): Promise<GeoJSONFeatureCollection<OcorrenciaProperties>> {
    const qs = new URLSearchParams();
    if (params?.especie_id) qs.set('especie_id', String(params.especie_id));
    if (params?.categoria) qs.set('categoria', params.categoria);
    if (params?.bioma) qs.set('bioma', String(params.bioma));
    if (params?.fonte) qs.set('fonte', params.fonte);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.bbox) qs.set('bbox', params.bbox);
    const query = qs.toString();
    const path = `/ocorrencias${query ? `?${query}` : ''}`;
    return fetchDeduplicated<GeoJSONFeatureCollection<OcorrenciaProperties>>(path);
  },

  async createOcorrencia(data: {
    especie_id: number; lat: number; lon: number;
    data_evento?: string; fonte?: string; base_registro?: string;
  }): Promise<{ id: number }> {
    return fetchApi<{ id: number }>('/ocorrencias', {
      method: 'POST', body: JSON.stringify(data),
    });
  },

  async deleteOcorrencia(id: number): Promise<{ message: string }> {
    return fetchApi<{ message: string }>(`/ocorrencias/${id}`, { method: 'DELETE' });
  },

  async getGbifOcorrencias(especie: string): Promise<GeoJSONFeatureCollection> {
    return fetchApi<GeoJSONFeatureCollection>(
      `/ocorrencias/gbif?especie=${encodeURIComponent(especie)}`
    );
  },

  // Dashboard
  async getDashboard(): Promise<DashboardData> {
    return fetchCached<DashboardData>('dashboard', '/dashboard');
  },

  async refreshDashboard(): Promise<{ message: string }> {
    responseCache.delete('dashboard');
    return fetchApi<{ message: string }>('/dashboard/refresh', { method: 'POST' });
  },
};
