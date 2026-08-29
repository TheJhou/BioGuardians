import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import StatCard from '../components/ui/StatCard.js';
import { api } from '../api/client.js';
import type { DashboardData } from '../types/index.js';

const dataSources = [
  { name: 'MMA', full: 'Ministério do Meio Ambiente', icon: '🏛️' },
  { name: 'GBIF', full: 'Global Biodiversity Information Facility', icon: '🌍' },
  { name: 'speciesLink', full: 'Repositório de dados da Rede SpeciesLink', icon: '🔗' },
  { name: 'CNUC', full: 'Cadastro Nacional de Unidades de Conservação', icon: '📋' },
];

export default function HomePage() {
  const [stats, setStats] = useState<DashboardData['stats'] | null>(null);

  useEffect(() => {
    api.getDashboard().then((d) => setStats(d.stats)).catch(() => null);
  }, []);

  const totalArea = stats?.area_total_ha ? Math.round(stats.area_total_ha).toLocaleString() : '—';

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">Monitoramento da Biodiversidade Brasileira</h1>
          <p className="hero-text">
            Acesse dados de espécies, unidades de conservação e ocorrências em todo o território nacional.
          </p>
          <Link to="/mapa" className="hero-cta">Explorar Mapa</Link>
        </div>
        <div className="hero-stats">
          <StatCard value={stats?.total_especies ?? '—'} label="Espécies registradas" icon="🐾" variant="info" />
          <StatCard value={stats?.total_ocorrencias ?? '—'} label="Ocorrências registradas" icon="📍" variant="info" />
          <StatCard value={stats?.total_areas ?? '—'} label="Unidades de Conservação cadastradas" icon="🌳" variant="info" />
        </div>
      </section>

      <section className="home-sources">
        <h2 className="section-title">Fontes de Dados</h2>
        <div className="sources-grid">
          {dataSources.map((s) => (
            <div key={s.name} className="source-card">
              <span className="source-icon">{s.icon}</span>
              <span className="source-name">{s.name}</span>
              <span className="source-full">{s.full}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
