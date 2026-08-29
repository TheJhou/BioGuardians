import { useState, useEffect } from 'react';
import { Doughnut, Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, PointElement, LineElement, Title, Tooltip, Legend,
  Filler,
} from 'chart.js';
import { api } from '../api/client.js';
import { CATEGORY_LABELS, CATEGORY_COLORS, SPHERE_COLORS, SPHERE_LABELS } from '../constants/index.js';
import StatCard from './ui/StatCard.js';
import type { DashboardData } from '../types/index.js';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Title, Tooltip, Legend, Filler
);

// Adapter/mock layer for data not yet in the main dashboard endpoint.
const MOCK_BIOMAS = [
  { nome: 'Amazônia', total: 1842 },
  { nome: 'Mata Atlântica', total: 1152 },
  { nome: 'Cerrado', total: 672 },
  { nome: 'Caatinga', total: 186 },
  { nome: 'Pantanal', total: 78 },
  { nome: 'Pampa', total: 38 },
];

const MOCK_ANOS = ['2018', '2019', '2020', '2021', '2022', '2023', '2024'];
const MOCK_SERIE = [1200, 1450, 1800, 2100, 2600, 3100, 3968];

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDashboard()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Carregando dashboard...</div>;
  if (error) return <div className="error">Erro: {error}</div>;
  if (!data) return null;

  const stats = data.stats;

  const biomasData = {
    labels: MOCK_BIOMAS.map((b) => b.nome),
    datasets: [{
      data: MOCK_BIOMAS.map((b) => b.total),
      backgroundColor: ['#16A36A', '#073B2A', '#9AD84B', '#DDF5E9', '#66736D', '#E3E9E5'],
      borderWidth: 0,
    }],
  };

  const temporalData = {
    labels: MOCK_ANOS,
    datasets: [{
      label: 'Ocorrências',
      data: MOCK_SERIE,
      borderColor: '#16A36A',
      backgroundColor: 'rgba(22, 163, 106, 0.1)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: '#16A36A',
    }],
  };

  const rankingData = {
    labels: data.ranking.map((r) => CATEGORY_LABELS[r.categoria_ameaca] || r.categoria_ameaca),
    datasets: [{
      data: data.ranking.map((r) => r.total),
      backgroundColor: data.ranking.map((r) => CATEGORY_COLORS[r.categoria_ameaca] || '#757575'),
      borderWidth: 0,
    }],
  };

  const esferaData = {
    labels: data.ucs_por_esfera.map((u) => SPHERE_LABELS[u.esfera.toLowerCase()] || u.esfera),
    datasets: [{
      data: data.ucs_por_esfera.map((u) => u.total),
      backgroundColor: data.ucs_por_esfera.map((u) => SPHERE_COLORS[u.esfera.toLowerCase()] || '#757575'),
      borderWidth: 0,
    }],
  };

  const ameacadas = stats.total_cr + stats.total_en + stats.total_vu;

  return (
    <div className="dashboard">
      {/* Stats */}
      <div className="stats-grid four">
        <StatCard value={stats.total_especies} label="Espécies registradas" />
        <StatCard value={stats.total_ocorrencias} label="Ocorrências registradas" />
        <StatCard value={stats.total_areas} label="Unidades de Conservação" />
        <StatCard value={7} label="Biomas mapeados" />
      </div>

      {/* Charts */}
      <div className="dashboard-grid two">
        <div className="dashboard-card large">
          <h3 className="card-title">Ocorrências por Bioma</h3>
          <div className="chart-doughnut">
            <Doughnut data={biomasData} options={{
              responsive: true,
              cutout: '70%',
              plugins: { legend: { position: 'right', labels: { boxWidth: 14 } } },
            }} />
            <div className="doughnut-center">
              <span className="big">{MOCK_BIOMAS.reduce((a, b) => a + b.total, 0).toLocaleString()}</span>
              <span>Total</span>
            </div>
          </div>
        </div>

        <div className="dashboard-card large">
          <h3 className="card-title">Ocorrências ao longo do tempo</h3>
          <Line data={temporalData} options={{
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, grid: { color: '#E3E9E5' } }, x: { grid: { display: false } } },
          }} />
        </div>
      </div>

      {/* Secondary cards */}
      <div className="dashboard-grid three">
        <div className="dashboard-card">
          <h3 className="card-title">UCs por Esfera</h3>
          <div className="mini-list">
            {data.ucs_por_esfera.map((u) => (
              <div key={u.esfera} className="mini-item">
                <span className="mini-label">{SPHERE_LABELS[u.esfera.toLowerCase()] || u.esfera}</span>
                <span className="mini-value">{u.total.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-card">
          <h3 className="card-title">UCs por Categoria</h3>
          <div className="mini-list">
            <div className="mini-item">
              <span className="mini-label">Proteção Integral</span>
              <span className="mini-value">1.985</span>
            </div>
            <div className="mini-item">
              <span className="mini-label">Uso Sustentável</span>
              <span className="mini-value">1.377</span>
            </div>
          </div>
        </div>

        <div className="dashboard-card">
          <h3 className="card-title">Espécies Ameaçadas</h3>
          <div className="threat-chart">
            <Doughnut data={{
              labels: ['Ameaçadas', 'Outras'],
              datasets: [{
                data: [ameacadas, Math.max(0, stats.total_especies - ameacadas)],
                backgroundColor: ['#16A36A', '#E3E9E5'],
                borderWidth: 0,
              }],
            }} options={{ responsive: true, cutout: '75%', plugins: { legend: { display: false } } }} />
            <div className="threat-center">
              <span className="big">{ameacadas}</span>
              <span>espécies</span>
            </div>
          </div>
          <p className="threat-pct">{((ameacadas / (stats.total_especies || 1)) * 100).toFixed(0)}% do total</p>
        </div>
      </div>
    </div>
  );
}
