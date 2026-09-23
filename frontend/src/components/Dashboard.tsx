import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import iconPage from '../images/icon-page.png';
import { Doughnut, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  ArcElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  Plugin,
} from 'chart.js';
import { api } from '../api/client.js';
import { UC_CATEGORY_LABELS } from '../constants/index.js';
import { getChartTheme } from '../constants/chartTheme.js';
import type { DashboardData } from '../types/index.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  ArcElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
);

const doughnutTotalPlugin: Plugin<'doughnut'> = {
  id: 'doughnutTotalDark',
  afterDraw(chart) {
    const arc = chart.getDatasetMeta(0).data[0] as ArcElement | undefined;
    if (!arc) return;

    const values = chart.data.datasets[0]?.data ?? [];
    const total = values.reduce((sum, value) => sum + Number(value), 0);
    const { ctx } = chart;
    const colors = getChartTheme().doughnutTotal;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.value;
    ctx.font = `800 ${Math.max(16, Math.round(arc.outerRadius * 0.22))}px Inter, sans-serif`;
    ctx.fillText(total.toLocaleString('pt-BR'), arc.x, arc.y - 5);
    ctx.fillStyle = colors.label;
    ctx.font = `500 ${Math.max(9, Math.round(arc.outerRadius * 0.09))}px Inter, sans-serif`;
    ctx.fillText('total', arc.x, arc.y + 14);
    ctx.restore();
  },
};

function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR');
}

function Icon({ type }: { type: 'leaf' | 'records' | 'shield' | 'database' }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (type === 'leaf') return <svg {...common}><path d="M20 4C10 4 4 10 4 20c6 0 12-2 15-7 1-2 1-5 1-9Z" /><path d="M4 20c3-4 6-7 11-10" /></svg>;
  if (type === 'records') return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
  if (type === 'shield') return <svg {...common}><path d="M12 3 19 6v5c0 5-3.2 8.5-7 10-3.8-1.5-7-5-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
  return <svg {...common}><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5" /><path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" /></svg>;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

useEffect(() => {
    let active = true;

    api.getDashboard()
      .then((dashboard) => {
        if (!active) return;

        setData(dashboard);
      })
      .catch((err) => {
        if (!active) return;

        setError(
          err instanceof Error
            ? err.message
            : 'Falha ao carregar o dashboard'
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <div className="dashboard-loading" role="status" aria-live="polite">Carregando dashboard...</div>;
  }

  if (error || !data) {
    return <div className="dashboard-error" role="alert">Erro ao carregar o dashboard: {error ?? 'dados indisponíveis'}.</div>;
  }

  const stats = data.stats;
  const theme = getChartTheme();

  const temporalData = {
    labels: data.ocorrencias_por_ano.map((item) => String(item.ano)),
    datasets: [{
      label: 'Ocorrências',
      data: data.ocorrencias_por_ano.map((item) => item.total),
      borderColor: theme.line.stroke,
      backgroundColor: theme.line.fill,
      fill: true,
      tension: 0.38,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      pointBackgroundColor: theme.line.stroke,
      pointBorderColor: theme.line.pointBorder,
      pointBorderWidth: 2,
    }],
  };

  const temporalOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        ...theme.tooltip,
        displayColors: false,
        callbacks: { label: (context: { parsed: { y: number | null } }) => `${formatNumber(context.parsed.y ?? 0)} ocorrências` },
      },
    },
    scales: {
      y: { beginAtZero: true, ticks: { color: theme.axis.tick, font: { size: 10 } }, grid: { color: theme.axis.gridY }, border: { display: false } },
      x: { ticks: { color: theme.axis.tick, font: { size: 10 } }, grid: { color: theme.axis.gridX }, border: { display: false } },
    },
  };

  const biomeColors = theme.biomes;
  const biomeData = {
    labels: data.especies_por_bioma.map((item) => item.nome),
    datasets: [{ data: data.especies_por_bioma.map((item) => item.total), backgroundColor: biomeColors, borderWidth: 0, hoverOffset: 5 }],
  };

  const recorrenciaColors = theme.topSpecies;
  const recorrenciaLabels = data.especies_mais_ocorrencias.map((item) => item.nome_popular ?? item.nome_cientifico);
  const recorrenciaData = {
    labels: recorrenciaLabels,
    datasets: [{
      data: data.especies_mais_ocorrencias.map((item) => item.total),
      backgroundColor: recorrenciaColors,
      borderWidth: 0,
      hoverOffset: 5,
    }],
  };

  const ucData = {
    labels: data.ucs_por_categoria.map((item) => UC_CATEGORY_LABELS[item.categoria_uc] ?? item.categoria_uc),
    datasets: [{
      data: data.ucs_por_categoria.map((item) => item.total),
      backgroundColor: data.ucs_por_categoria.map((item) => theme.ucCategory(item.categoria_uc)),
      borderWidth: 0,
      hoverOffset: 5,
    }],
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '69%',
    plugins: {
      legend: { display: false },
      tooltip: theme.tooltip,
    },
  };

  const sources = ['MMA', 'GBIF', 'speciesLink', 'CNUC', 'Wildlife Insights', 'IA (OpenRouter)', 'iNaturalist'];

  return (
    <div className="dashboard-page">
      <aside className="dashboard-sidebar" aria-label="Identidade do BioGuardians">
        <div className="dashboard-sidebar-copy">
          <p>Conhecimento hoje.<br /><strong>Conservação sempre.</strong></p>
          <div className="dashboard-sidebar-brand">
            <img className="dashboard-sidebar-brand-mark" src={iconPage} alt="" width="24" height="24" />
            <span>BioGuardians</span>
          </div>
        </div>
      </aside>

      <div className="dashboard-shell dashboard-main container">
        <section className="dashboard-stats" aria-label="Indicadores principais">
          <article className="dashboard-stat">
            <div className="dashboard-stat-head"><span className="dashboard-stat-icon"><Icon type="leaf" /></span><span className="dashboard-stat-label">Espécies registradas</span></div>
            <strong className="dashboard-stat-value">{formatNumber(stats.total_especies)}</strong>
            <span className="dashboard-stat-meta">Base cadastrada</span>
          </article>
          <article className="dashboard-stat">
            <div className="dashboard-stat-head"><span className="dashboard-stat-icon"><Icon type="records" /></span><span className="dashboard-stat-label">Ocorrências registradas</span></div>
            <strong className="dashboard-stat-value">{formatNumber(stats.total_ocorrencias)}</strong>
            <span className="dashboard-stat-meta">Registros disponíveis</span>
          </article>
          <article className="dashboard-stat">
            <div className="dashboard-stat-head"><span className="dashboard-stat-icon"><Icon type="shield" /></span><span className="dashboard-stat-label">Unidades de Conservação</span></div>
            <strong className="dashboard-stat-value">{formatNumber(stats.total_areas)}</strong>
            <span className="dashboard-stat-meta">Áreas cadastradas</span>
          </article>
          <article className="dashboard-stat">
            <div className="dashboard-stat-head"><span className="dashboard-stat-icon"><Icon type="database" /></span><span className="dashboard-stat-label">Fontes de dados</span></div>
            <strong className="dashboard-stat-value">{sources.length}</strong>
            <span className="dashboard-stat-meta muted">{sources.join(', ')}</span>
          </article>
        </section>

        <div className="dashboard-grid">
          <section className="dashboard-panel dashboard-panel--chart">
            <div className="dashboard-panel-inner">
              <div className="dashboard-panel-header">
                <div><h2 className="dashboard-panel-title">Ocorrências ao longo do tempo</h2><p className="dashboard-panel-subtitle">Total de registros por ano, conforme os dados disponíveis na API.</p></div>
              </div>
              <div className="dashboard-chart"><Line data={temporalData} options={temporalOptions} /></div>
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-inner">
              <div className="dashboard-panel-header">
                <div><h2 className="dashboard-panel-title">Espécies mais presentes em UCs</h2><p className="dashboard-panel-subtitle">Ranking calculado a partir das relações espécie × unidade de conservação.</p></div>
                <Link to="/especies" className="dashboard-link">Ver todas →</Link>
              </div>
              <ol className="dashboard-ranking">
                {data.especies_mais_presentes_uc.length ? data.especies_mais_presentes_uc.map((item, index) => (
                  <li className="dashboard-ranking-item" key={item.especie_id}>
                    <span className="dashboard-rank">{index + 1}</span>
                    {item.imagem_url ? <img className="dashboard-ranking-avatar" src={item.imagem_url} alt="" /> : <div className="dashboard-ranking-avatar" aria-hidden="true" />}
                    <span className="dashboard-ranking-name">
                      {item.nome_popular ?? item.nome_cientifico}
                      <small>{item.nome_cientifico}</small>
                    </span>
                    <span className="dashboard-ranking-value">{item.total_ucs} UCs</span>
                    <span className="dashboard-ranking-arrow" aria-hidden="true">›</span>
                  </li>
                )) : <li className="dashboard-panel-subtitle">Não há dados suficientes para montar o ranking.</li>}
              </ol>
            </div>
          </section>

          <div className="dashboard-grid-doughnuts">
          <section className="dashboard-panel dashboard-panel--doughnut">
            <div className="dashboard-panel-inner">
              <div className="dashboard-panel-header"><div><h2 className="dashboard-panel-title">Espécies por bioma</h2><p className="dashboard-panel-subtitle">Distribuição disponível no dashboard atual.</p></div></div>
              <div className="dashboard-doughnut-row">
                <div className="dashboard-legend">
                  {data.especies_por_bioma.map((item, index) => <div className="dashboard-legend-item" key={item.nome}><span className="dashboard-legend-dot" style={{ background: biomeColors[index % biomeColors.length] }} /><span>{item.nome} · {formatNumber(item.total)}</span></div>)}
                </div>
                <div className="dashboard-doughnut"><Doughnut data={biomeData} plugins={[doughnutTotalPlugin]} options={doughnutOptions} /></div>
              </div>
            </div>
          </section>

          <section className="dashboard-panel dashboard-panel--doughnut">
            <div className="dashboard-panel-inner">
              <div className="dashboard-panel-header"><div><h2 className="dashboard-panel-title">Unidades de Conservação por categoria</h2><p className="dashboard-panel-subtitle">Totais reais retornados pela aplicação.</p></div></div>
              <div className="dashboard-doughnut-row">
                <div className="dashboard-legend">
                  {data.ucs_por_categoria.map((item) => <div className="dashboard-legend-item" key={item.categoria_uc}><span className="dashboard-legend-dot" style={{ background: theme.ucCategory(item.categoria_uc) }} /><span>{UC_CATEGORY_LABELS[item.categoria_uc] ?? item.categoria_uc} · {formatNumber(item.total)}</span></div>)}
                </div>
                <div className="dashboard-doughnut"><Doughnut data={ucData} plugins={[doughnutTotalPlugin]} options={doughnutOptions} /></div>
              </div>
            </div>
          </section>

          <section className="dashboard-panel dashboard-panel--doughnut">
            <div className="dashboard-panel-inner">
              <div className="dashboard-panel-header"><div><h2 className="dashboard-panel-title">Maior recorrência por espécie</h2><p className="dashboard-panel-subtitle">As 6 espécies com mais ocorrências registradas no banco.</p></div></div>
              <div className="dashboard-doughnut-row">
                <div className="dashboard-legend">
                  {data.especies_mais_ocorrencias.map((item, index) => <div className="dashboard-legend-item" key={item.especie_id}><span className="dashboard-legend-dot" style={{ background: recorrenciaColors[index % recorrenciaColors.length] }} /><span>{item.nome_popular ?? item.nome_cientifico} · {formatNumber(item.total)}</span></div>)}
                </div>
                <div className="dashboard-doughnut"><Doughnut data={recorrenciaData} plugins={[doughnutTotalPlugin]} options={doughnutOptions} /></div>
              </div>
            </div>
          </section>
          </div>
        </div>

      </div>
    </div>
  );
}
