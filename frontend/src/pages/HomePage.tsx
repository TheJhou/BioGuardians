import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useScrollReveal } from '../lib/scroll-reveal';
import Header from '../components/layout/Header.js';
import LeafIcon from '../components/icons/LeafIcon.js';
import GraficoIcon from '../components/icons/GraficoIcon.js';
import PersonsIcon from '../components/icons/PersonsIcon.js';
import DocumentIcon from '../components/icons/DocumentIcon.js';
import ShieldIcon from '../components/icons/ShieldIcon.js';
import DatabaseIcon from '../components/icons/DatabaseIcon.js';
import type { DashboardStats } from '../types/index.js';
import cardMapsImg from '../images/card-maps-home.png';
import cardEspecieImg from '../images/card-especie-home.png';
import cardUcsImg from '../images/card-unid-conservacao-home.png';

const platformCards: { title: string; description: ReactNode; to: string; image?: string }[] = [
  {
    title: 'Mapa interativo',
    description: <>Visualize a distribuição de espécies,<br />ocorrências e unidades de conservação<br />em todo o Brasil.</>,
    to: '/mapa',
    image: cardMapsImg,
  },
  {
    title: 'Catálogo de espécies',
    description: <>Explore informações detalhadas<br />sobre a fauna e flora brasileira.</>,
    to: '/especies',
    image: cardEspecieImg,
  },
  {
    title: 'Unidades de conservação',
    description: <>Descubra áreas protegidas e sua<br />importância para a preservação<br />da biodiversidade.</>,
    to: '/dashboard',
    image: cardUcsImg,
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
  const revealRef = useScrollReveal<HTMLDivElement>();

  useEffect(() => {
    api.getDashboard()
      .then((d) => setStats(d.stats))
      .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="home-page">
      <Header />
      <div className="home-scroll" ref={revealRef}>
      {/* ===== Seção 1 — Hero + Features + Stats ===== */}
      <section className="home-section home-section--hero">
        <div className="hero-content" data-reveal>
          <span className="hero-tag">Biodiversidade em foco</span>
          <h1 className="hero-title">
            Dados para proteger<br />
            <span className="hero-accent">o que importa.</span>
          </h1>
          <p className="hero-text">
            Explore informações sobre espécies, ocorrências e <br className="br-desktop" />
            unidades de conservação em todo o território brasileiro. <br className="br-desktop" />
            Ciência, tecnologia e dados abertos a serviço da natureza.
          </p>
          <div className="hero-actions">
            <Link to="/mapa" className="home-cta">
              Explorar o mapa →
            </Link>
            <Link to="/especies" className="home-cta home-cta--outline">
              Conhecer espécies
            </Link>
          </div>
        </div>

        <div className="hero-features">
          <div className="feature-item" data-reveal>
            <div className="feature-icon"><DocumentIcon size={22} color="var(--green-accent)" /></div>
            <span>Dados abertos <br className="br-desktop" />e confiáveis</span>
          </div>
          <div className="feature-item" data-reveal>
            <div className="feature-icon"><GraficoIcon size={22} color="var(--green-accent)" /></div>
            <span>Informação para <br className="br-desktop" />decisões reais</span>
          </div>
          <div className="feature-item" data-reveal>
            <div className="feature-icon"><PersonsIcon size={22} color="var(--green-accent)" /></div>
            <span>Contribuindo para um <br className="br-desktop" />futuro sustentável</span>
          </div>
        </div>

        <div className="home-stats-bar" data-reveal>
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
                <LeafIcon size={52} color="var(--green-accent)" />
                <span className="stats-value">{error ? '—' : formatPlus(stats?.total_especies ?? 0)}</span>
                <span className="stats-label">Espécies registradas</span>
              </div>
              <div className="stats-section">
                <DocumentIcon size={52} color="var(--green-accent)" />
                <span className="stats-value">{error ? '—' : formatPlus(stats?.total_ocorrencias ?? 0)}</span>
                <span className="stats-label">Ocorrências registradas</span>
              </div>
              <div className="stats-section">
                <ShieldIcon size={52} color="var(--green-accent)" />
                <span className="stats-value">{error ? '—' : formatPlus(stats?.total_areas ?? 0)}</span>
                <span className="stats-label">Unidades de Conservação</span>
              </div>
              <div className="stats-section">
                <DatabaseIcon size={52} color="var(--green-accent)" />
                <span className="stats-value">{sourceCards.length}</span>
                <span className="stats-label">Fontes oficiais</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ===== Seção 2 — Plataforma + Fontes + CTA ===== */}
      <section className="home-section home-section--content">

        {/* --- Explore a plataforma --- */}
        <div className="section-block" data-reveal>
          <span className="section-eyebrow">Explore a plataforma</span>
          <h2 className="section-heading">Tudo sobre a biodiversidade,<br />em um só lugar.</h2>
          <p className="section-subtitle">
            Acesse mapas interativos, conheça espécies, explore áreas de conservação
            e gere insights a partir de dados confiáveis.
          </p>
        </div>

        <div className="platform-cards">
          {platformCards.map((card) => (
            <Link key={card.title} to={card.to} className="platform-card" data-reveal>
              <div className="platform-card-body">
                <div className="platform-card-header">
                  <div className="icon-placeholder" data-label="ícone" />
                  <h3 className="platform-card-title">{card.title}</h3>
                </div>
                <p className="platform-card-text">{card.description}</p>
              </div>
              <div className="platform-card-image">
                {card.image ? (
                  <img src={card.image} alt={card.title} className="platform-card-img" />
                ) : (
                  <div className="image-placeholder" data-label="imagem" />
                )}
                <span className="platform-card-arrow">→</span>
              </div>
            </Link>
          ))}
        </div>

        {/* --- Fontes de dados confiáveis --- */}
        <div className="section-block" data-reveal>
          <div className="section-header">
            <div>
              <h2 className="section-heading">Fontes de dados confiáveis</h2>
              <p className="section-subtitle">
                Integramos informações de instituições referência em biodiversidade e meio ambiente.
              </p>
            </div>
          </div>
          <div className="sources-cards">
            {sourceCards.map((s) => (
              <div key={s.name} className="source-card" data-reveal>
                <div className="icon-placeholder icon-placeholder--sm" data-label="ícone" />
                <div className="source-card-info">
                  <span className="source-name">{s.name}</span>
                  <span className="source-desc">{s.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* --- CTA banner --- */}
        <div className="cta-banner" data-reveal>
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
    </div>
  );
}
