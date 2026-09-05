// BioGuardians TypeScript types for API responses.

export interface Bioma {
  id: number;
  nome: string;
  descricao: string | null;
}

export interface Estado {
  uf: string;
  nome: string;
  regiao: string;
}

export interface Categoria {
  codigo: string;
  nome: string;
  descricao: string | null;
  ordem_prioridade: number;
}

export interface Taxon {
  id: number;
  nome: string;
  rank: string;
  parent_id: number | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface Especie {
  id: number;
  nome_cientifico: string;
  nome_popular: string | null;
  categoria_ameaca: string;
  status: string;
  criado_em?: string;
  atualizado_em?: string;
  descricao?: string | null;
  imagem_url?: string | null;
  genero_id?: number;
  genero_nome?: string;
  biomas?: Bioma[];
  estados?: Estado[];
}

export interface EspecieBusca {
  especie_id: number;
  nome_cientifico: string;
  nome_popular: string | null;
  categoria: string;
  relevancia: number;
}

export interface AreaProtegida {
  id: number;
  nome: string;
  categoria_uc: string;
  esfera: string;
  bioma_id: number | null;
  area_ha: number | null;
  criado_em?: string;
  atualizado_em?: string;
}

export interface EspecieEmArea {
  especie_id: number;
  nome_cientifico: string;
  nome_popular: string | null;
  categoria: string;
}

export interface AreaProtegeEspecie {
  area_id: number;
  nome: string;
  categoria_uc: string;
  esfera: string;
}

export interface OcorrenciaProperties {
  especie_id: number;
  lat: number;
  lon: number;
  data_evento: string | null;
  fonte: string;
  base_registro: string | null;
  confianca_ia?: number | null;
  nome_cientifico: string;
  nome_popular: string | null;
  imagem_url: string | null;
  categoria_ameaca: string;
}

export interface DashboardStats {
  id: number;
  total_especies: number;
  total_cr: number;
  total_en: number;
  total_vu: number;
  total_nt: number;
  total_lc: number;
  total_dd: number;
  total_areas: number;
  area_total_ha: number | null;
  total_ocorrencias: number;
}

export interface RankingCategoria {
  categoria_ameaca: string;
  total: number;
}

export interface UcsPorEsfera {
  esfera: string;
  total: number;
  area_ha: number | null;
}

export interface EspeciePorUc {
  area_id: number;
  area_nome: string;
  especie_id: number;
  nome_cientifico: string;
  categoria_ameaca: string;
}

export interface DashboardData {
  stats: DashboardStats;
  ranking: RankingCategoria[];
  ucs_por_esfera: UcsPorEsfera[];
  especies_por_uc: EspeciePorUc[];
}

// GeoJSON types
export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface GeoJSONFeature<P = Record<string, unknown>> {
  type: 'Feature';
  id?: number;
  geometry: GeoJSONPoint | GeoJSONPolygon;
  properties: P;
}

export interface GeoJSONFeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: GeoJSONFeature<P>[];
}
