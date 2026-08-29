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
};

// --- Threat category labels ---
export const CATEGORY_LABELS: Record<string, string> = {
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
  DD: 'Data Deficient',
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
  { codigo: 'CR', nome: 'CR - Critically Endangered' },
  { codigo: 'EN', nome: 'EN - Endangered' },
  { codigo: 'VU', nome: 'VU - Vulnerable' },
  { codigo: 'NT', nome: 'NT - Near Threatened' },
  { codigo: 'LC', nome: 'LC - Least Concern' },
  { codigo: 'DD', nome: 'DD - Data Deficient' },
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
