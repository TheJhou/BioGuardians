// Cores dos gráficos (Chart.js), lidas dos tokens de styles/tokens.css em
// tempo de execução: trocar a paleta no CSS atualiza os gráficos também.

export type PaletteToken =
  | 'bg' | 'surface' | 'primary' | 'accent' | 'accent-strong' | 'text-muted' | 'white'
  | 'mint' | 'yellow' | 'orange' | 'gray' | 'violet';

// Lê "--rgb-<nome>" (ex.: "68 216 142") e devolve rgba() com vírgulas — o
// formato que o parser de cores do Chart.js entende em todas as versões.
export function tokenColor(name: PaletteToken, alpha = 1): string {
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue(`--rgb-${name}`)
    .trim()
    .split(/\s+/);
  const [r, g, b] = channels.length === 3 ? channels : ['0', '0', '0'];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Valores montados na hora do render (depois que o CSS já foi aplicado).
export function getChartTheme() {
  const tooltip = {
    backgroundColor: tokenColor('surface'),
    borderColor: tokenColor('text-muted', 0.25),
    borderWidth: 1,
    titleColor: tokenColor('white'),
    bodyColor: tokenColor('text-muted'),
  };

  return {
    tooltip,
    line: {
      stroke: tokenColor('accent'),
      fill: tokenColor('accent', 0.15),
      pointBorder: tokenColor('bg'),
    },
    axis: {
      tick: tokenColor('text-muted', 0.55),
      gridY: tokenColor('white', 0.07),
      gridX: tokenColor('white', 0.045),
    },
    doughnutTotal: {
      value: tokenColor('white'),
      label: tokenColor('text-muted', 0.68),
    },
    // Séries das rosquinhas (ordem = ordem das fatias)
    biomes: (['accent', 'accent-strong', 'mint', 'yellow', 'orange', 'gray', 'violet'] as const).map((t) => tokenColor(t)),
    topSpecies: (['accent-strong', 'accent', 'mint', 'primary', 'text-muted', 'violet'] as const).map((t) => tokenColor(t)),
    ucCategory: (categoria: string) => tokenColor(categoria === 'protecao_integral' ? 'accent' : 'mint'),
  };
}
