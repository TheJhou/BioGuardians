// Shared constants for BioGuardians frontend.
// Centralizes colors, labels, and configuration to avoid hardcoding.

// --- Threat category colors (IUCN/MMA standard) ---
export const CATEGORY_COLORS: Record<string, string> = {
  CR: '#d32f2f', // red — Critically Endangered
  EN: '#f57c00', // orange — Endangered
  VU: '#fbc02d', // yellow — Vulnerable
  NT: '#689f38', // light green — Near Threatened
  LC: '#388e3c', // green — Least Concern
  DD: '#757575', // gray — Data Deficient
  NE: '#90a4ae', // blue-gray — Not Evaluated / non-wildlife
};

// --- Threat category labels (Portuguese, public-friendly) ---
export const CATEGORY_LABELS: Record<string, string> = {
  CR: 'CR — Criticamente em Perigo',
  EN: 'EN — Entrando em Extinção',
  VU: 'VU — Alto Risco de Entrar em Extinção',
  NT: 'NT — Em Ameaça',
  LC: 'LC — Sem Risco',
  DD: 'DD — Sem Dados para Avaliar',
  NE: 'NE — Não Avaliada',
};

// --- UC category colors ---
export const UC_CATEGORY_COLORS: Record<string, string> = {
  protecao_integral: '#1565c0',  // blue
  uso_sustentavel: '#2e7d32',    // green
};

// --- UC category labels ---
export const UC_CATEGORY_LABELS: Record<string, string> = {
  protecao_integral: 'Protecao Integral',
  uso_sustentavel: 'Uso Sustentavel',
};

// --- Sphere colors ---
export const SPHERE_COLORS: Record<string, string> = {
  federal: '#1565c0',
  estadual: '#2e7d32',
  municipal: '#f57c00',
  particular: '#757575',
};

// --- Sphere labels ---
export const SPHERE_LABELS: Record<string, string> = {
  federal: 'Federal',
  estadual: 'Estadual',
  municipal: 'Municipal',
  particular: 'Particular',
};

// --- Biome options for filter dropdowns ---
export const BIOME_OPTIONS = [
  { id: 1, nome: 'Amazonia' },
  { id: 2, nome: 'Mata Atlantica' },
  { id: 3, nome: 'Cerrado' },
  { id: 4, nome: 'Caatinga' },
  { id: 5, nome: 'Pampa' },
  { id: 6, nome: 'Pantanal' },
  { id: 7, nome: 'Marinho' },
];

// --- UC category options for map filter dropdowns ---
export const UC_CATEGORY_OPTIONS = [
  { codigo: 'protecao_integral', nome: 'Proteção Integral' },
  { codigo: 'uso_sustentavel', nome: 'Uso Sustentável' },
];

// --- Sphere options for map filter dropdowns ---
export const SPHERE_OPTIONS = [
  { value: 'federal', nome: 'Federal' },
  { value: 'estadual', nome: 'Estadual' },
  { value: 'municipal', nome: 'Municipal' },
  { value: 'particular', nome: 'Particular' },
];

// --- Category options for filter dropdowns ---
export const CATEGORY_OPTIONS = [
  { codigo: 'CR', nome: 'CR - Criticamente em Perigo' },
  { codigo: 'EN', nome: 'EN - Entrando em Extinção' },
  { codigo: 'VU', nome: 'VU - Alto Risco de Entrar em Extinção' },
  { codigo: 'NT', nome: 'NT - Em Ameaça' },
  { codigo: 'LC', nome: 'LC - Sem Risco' },
  { codigo: 'DD', nome: 'DD - Sem Dados para Avaliar' },
  { codigo: 'NE', nome: 'NE - Não Avaliada' },
];

// --- Status options ---
export const STATUS_OPTIONS = [
  { value: 'ativo', label: 'Active' },
  { value: 'inativo', label: 'Inactive' },
  { value: 'revisao', label: 'Under Review' },
];

// --- Map defaults ---
export const MAP_DEFAULTS = {
  center: { lat: -14, lng: -52 },
  zoom: 4,
};

// --- Helper: get color for a category, fallback to gray ---
export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || '#757575';
}

// --- Helper: get color for a UC category, fallback to blue ---
export function getUcCategoryColor(category: string): string {
  return UC_CATEGORY_COLORS[category] || '#1565c0';
}
