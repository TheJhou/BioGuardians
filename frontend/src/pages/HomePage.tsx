import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import type { DashboardStats } from '../types/index.js';

const platformCards = [
  {
    title: 'Mapa interativo',
    description: 'Visualize a distribuição de espécies, ocorrências e unidades de conservação em todo o Brasil.',
    to: '/mapa',
  },
  {
    title: 'Catálogo de espécies',
    description: 'Explore informações detalhadas sobre a fauna e flora brasileira.',
    to: '/especies',
  },
  {
    title: 'Unidades de conservação',
    description: 'Descubra áreas protegidas e sua importância para a preservação da biodiversidade.',
    to: '/dashboard',
  },
];

const sourceCards = [
  { name: 'MMA', desc: 'Ministério do Meio Ambiente', detail: 'Lista oficial de espécies ameaçadas' },
  { name: 'GBIF', desc: 'Global Biodiversity Information Facility', detail: 'Ocorrências globais de espécies' },
  { name: 'speciesLink', desc: 'Repositório de dados da Rede SpeciesLink', detail: 'Dados de biodiversidade brasileira' },
  { name: 'CNUC', desc: 'Cadastro Nacional de Unidades de Conservação', detail: 'Áreas protegidas do Brasil' },
  { name: 'Wildlife Insights', desc: 'Imagens de camera trap', detail: 'Metadados de monitoramento' },
  { name: 'IA (OpenRouter)', desc: 'Classificação de espécies', detail: 'Claude Sonnet 4' },
  { name: 'iNaturalist', desc: 'Fotos e taxonomia', detail: 'Enriquecimento de espécies' },
];

function formatPlus(value: number): string {
  return `${value}+`;
}

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
      {/* ===== Seção 1 — Hero + Features + Stats ===== */}
      <section className="home-section home-section--hero">
        <div className="hero-content">
          <span className="hero-tag">Biodiversidade em foco</span>
          <h1 className="hero-title">
            Dados para proteger<br />
            <span className="hero-accent">o que importa.</span>
          </h1>
          <p className="hero-text">
            Explore informações sobre espécies, ocorrências e unidades de conservação
            em todo o território brasileiro. Ciência, tecnologia e dados abertos
            a serviço da natureza.
          </p>
          <div className="hero-actions">
            <Link to="/mapa" className="home-cta">
              Explorar o mapa
            </Link>
            <Link to="/especies" className="home-cta home-cta--outline">
              Conhecer espécies
            </Link>
          </div>
        </div>

        <div className="hero-features">
          <div className="feature-item">
            <div className="icon-placeholder icon-placeholder--sm" data-label="ícone" />
            <span>Dados abertos e confiáveis</span>
          </div>
          <div className="feature-item">
            <div className="icon-placeholder icon-placeholder--sm" data-label="ícone" />
            <span>Informação para decisões reais</span>
          </div>
          <div className="feature-item">
            <div className="icon-placeholder icon-placeholder--sm" data-label="ícone" />
            <span>Contribuindo para um futuro sustentável</span>
          </div>
        </div>

        <div className="home-stats-bar">
          {loading ? (
            <div className="stats-card stats-card--loading">
              <div className="stat-skeleton" />
              <div className="stat-skeleton" />
              <div className="stat-skeleton" />
              <div className="stat-skeleton" />
            </div>
          ) : (
            <div className="stats-card">
              <div className="stats-section">
                <div className="icon-placeholder icon-placeholder--sm" data-label="ícone" />
                <span className="stats-value">{error ? '—' : formatPlus(stats?.total_especies ?? 0)}</span>
                <span className="stats-label">Espécies registradas</span>
              </div>
              <div className="stats-section">
                <div className="icon-placeholder icon-placeholder--sm" data-label="ícone" />
                <span className="stats-value">{error ? '—' : formatPlus(stats?.total_ocorrencias ?? 0)}</span>
                <span className="stats-label">Ocorrências registradas</span>
              </div>
              <div className="stats-section">
                <div className="icon-placeholder icon-placeholder--sm" data-label="ícone" />
                <span className="stats-value">{error ? '—' : formatPlus(stats?.total_areas ?? 0)}</span>
                <span className="stats-label">Unidades de Conservação</span>
              </div>
              <div className="stats-section">
                <div className="icon-placeholder icon-placeholder--sm" data-label="ícone" />
                <span className="stats-value">4</span>
                <span className="stats-label">Fontes oficiais</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ===== Seção 2 — Plataforma + Fontes + CTA ===== */}
      <section className="home-section home-section--content">

        {/* --- Explore a plataforma --- */}
        <div className="section-block">
          <span className="section-eyebrow">Explore a plataforma</span>
          <h2 className="section-heading">Tudo sobre a biodiversidade, em um só lugar.</h2>
          <p className="section-subtitle">
            Acesse mapas interativos, conheça espécies, explore áreas de conservação
            e gere insights a partir de dados confiáveis.
          </p>
        </div>

        <div className="platform-cards">
          {platformCards.map((card) => (
            <Link key={card.title} to={card.to} className="platform-card">
              <div className="platform-card-body">
                <div className="platform-card-header">
                  <div className="icon-placeholder" data-label="ícone" />
                  <h3 className="platform-card-title">{card.title}</h3>
                </div>
                <p className="platform-card-text">{card.description}</p>
              </div>
              <div className="platform-card-image">
                <div className="image-placeholder" data-label="imagem" />
                <span className="platform-card-arrow">→</span>
              </div>
            </Link>
          ))}
        </div>

        {/* --- Fontes de dados confiáveis --- */}
        <div className="section-block">
          <div className="section-header">
            <div>
              <h2 className="section-heading">Fontes de dados confiáveis</h2>
              <p className="section-subtitle">
                Integramos informações de instituições referência em biodiversidade e meio ambiente.
              </p>
            </div>
            <a href="#" className="section-link">Ver todas as fontes →</a>
          </div>
          <div className="sources-cards">
            {sourceCards.map((s) => (
              <div key={s.name} className="source-card">
                <div className="icon-placeholder icon-placeholder--sm" data-label="ícone" />
                <div className="source-card-info">
                  <span className="source-name">{s.name}</span>
                  <span className="source-desc">{s.desc}</span>
                </div>
                <span className="source-arrow">→</span>
              </div>
            ))}
          </div>
        </div>

        {/* --- CTA banner --- */}
        <div className="cta-banner">
          <div className="cta-banner-left">
            <span className="cta-eyebrow">Natureza hoje,<br />Oportunidades amanhã</span>
            <h2 className="cta-title">
              Informação que<br />
              conecta <span className="hero-accent">pessoas e natureza.</span>
            </h2>
          </div>
          <div className="cta-banner-right">
            <p className="cta-text">
              Acreditamos no poder dos dados para construir um futuro mais justo
              e sustentável para a biodiversidade brasileira.
            </p>
            <Link to="/mapa" className="home-cta home-cta--sm">
              Explorar o mapa →
            </Link>
          </div>
        </div>

      </section>
    </div>
  );
}
