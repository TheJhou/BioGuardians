import { useState, useEffect } from 'react';
import { Bar, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Title, Tooltip, Legend,
} from 'chart.js';
import { api } from '../api/client.js';
import { CATEGORY_LABELS, CATEGORY_COLORS, SPHERE_COLORS } from '../constants/index.js';
import type { DashboardData } from '../types/index.js';

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  ArcElement, Title, Tooltip, Legend
);

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.getDashboard();
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshDashboard();
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <div className="loading">Loading dashboard...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!data) return null;

  const stats = data.stats;

  const rankingData = {
    labels: data.ranking.map((r) => CATEGORY_LABELS[r.categoria_ameaca] || r.categoria_ameaca),
    datasets: [{
      label: 'Species Count',
      data: data.ranking.map((r) => r.total),
      backgroundColor: data.ranking.map((r) => CATEGORY_COLORS[r.categoria_ameaca] || '#757575'),
    }],
  };

  const esferaData = {
    labels: data.ucs_por_esfera.map((u) => u.esfera),
    datasets: [{
      data: data.ucs_por_esfera.map((u) => u.total),
      backgroundColor: data.ucs_por_esfera.map((u) => SPHERE_COLORS[u.esfera] || '#757575'),
    }],
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <button className="btn btn-primary" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>

      {/* Stats cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-value">{stats.total_especies}</span>
          <span className="stat-label">Total Species</span>
        </div>
        <div className="stat-card stat-cr">
          <span className="stat-value">{stats.total_cr}</span>
          <span className="stat-label">Critically Endangered</span>
        </div>
        <div className="stat-card stat-en">
          <span className="stat-value">{stats.total_en}</span>
          <span className="stat-label">Endangered</span>
        </div>
        <div className="stat-card stat-vu">
          <span className="stat-value">{stats.total_vu}</span>
          <span className="stat-label">Vulnerable</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.total_areas}</span>
          <span className="stat-label">Protected Areas</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">
            {stats.area_total_ha ? Math.round(stats.area_total_ha).toLocaleString() : 0}
          </span>
          <span className="stat-label">Total Area (ha)</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.total_ocorrencias}</span>
          <span className="stat-label">Occurrences</span>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Species by Threat Category</h3>
          <Bar data={rankingData} options={{
            responsive: true,
            plugins: { legend: { display: false } },
          }} />
        </div>

        <div className="chart-card">
          <h3>Protected Areas by Sphere</h3>
          <Pie data={esferaData} options={{
            responsive: true,
            plugins: { legend: { position: 'bottom' } },
          }} />
        </div>
      </div>

      {/* Species per UC table */}
      <div className="table-card">
        <h3>Threatened Species per Protected Area</h3>
        {data.especies_por_uc.length === 0 ? (
          <p className="empty-state">No threatened species found inside protected areas.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Protected Area</th>
                <th>Species</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {data.especies_por_uc.map((row, i) => (
                <tr key={`${row.area_id}-${row.especie_id}-${i}`}>
                  <td>{row.area_nome}</td>
                  <td className="scientific-name">{row.nome_cientifico}</td>
                  <td>
                    <span className={`cat-badge cat-${row.categoria_ameaca.toLowerCase()}`}>
                      {row.categoria_ameaca}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
