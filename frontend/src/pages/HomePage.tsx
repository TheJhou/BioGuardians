import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import StatCard from '../components/ui/StatCard.js';
import type { DashboardStats } from '../types/index.js';

const dataSources = [
  { name: 'MMA', full: 'Ministério do Meio Ambiente — lista oficial de espécies ameaçadas' },
  { name: 'GBIF', full: 'Global Biodiversity Information Facility — ocorrências' },
  { name: 'speciesLink', full: 'Repositório de dados da Rede SpeciesLink' },
  { name: 'CNUC', full: 'Cadastro Nacional de Unidades de Conservação' },
  { name: 'Wildlife Insights', full: 'Imagens de camera trap com metadados' },
  { name: 'IA (OpenRouter)', full: 'Classificação de espécies em imagens com Claude Sonnet 4' },
  { name: 'iNaturalist', full: 'Fotos e enriquecimento taxonômico das espécies' },
];

export default function HomePage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDashboard()
      .then((d) => setStats(d.stats))
      .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="home-page">
      <section className="hero" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1600)' }}>
        <div className="hero-overlay" aria-hidden="true" />
        <div className="hero-content">
          <h1 className="hero-title">
            Monitoramento da <br />
            <span className="hero-accent">Biodiversidade</span> Brasileira
          </h1>
          <p className="hero-text">
            Explore dados de espécies, unidades de conservação e ocorrências em todo o território nacional.
          </p>
          <Link to="/mapa" className="hero-cta">
            Explorar Mapa
          </Link>

          <div className="hero-stats">
            {loading ? (
              <>
                <div className="stat-skeleton" />
                <div className="stat-skeleton" />
                <div className="stat-skeleton" />
              </>
            ) : error ? (
              <p className="hero-error">{error}</p>
            ) : (
              <>
                <StatCard value={stats?.total_especies ?? 0} label="Espécies registradas" variant="info" />
                <StatCard value={stats?.total_ocorrencias ?? 0} label="Ocorrências registradas" variant="info" />
                <StatCard value={stats?.total_areas ?? 0} label="Unidades de Conservação cadastradas" variant="info" />
              </>
            )}
          </div>
        </div>
      </section>

      <section className="home-sources">
        <h2 className="section-title">Fontes de Dados</h2>
        <div className="sources-grid">
          {dataSources.map((s) => (
            <div key={s.name} className="source-card">
              <span className="source-name">{s.name}</span>
              <span className="source-full">{s.full}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
