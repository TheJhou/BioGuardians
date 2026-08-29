import { useLocation } from 'react-router-dom';

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'BioGuardians', subtitle: 'Monitoramento da Biodiversidade Brasileira' },
  '/mapa': { title: 'Mapa', subtitle: 'Explore ocorrências e unidades de conservação' },
  '/especies': { title: 'Espécies', subtitle: 'Catálogo de espécies brasileiras' },
  '/dashboard': { title: 'Dashboard', subtitle: 'Visão geral da biodiversidade brasileira' },
  '/unidades-conservacao': { title: 'Unidades de Conservação', subtitle: 'Áreas protegidas do Brasil' },
  '/ocorrencias': { title: 'Ocorrências', subtitle: 'Registros de ocorrências' },
  '/relatorios': { title: 'Relatórios', subtitle: 'Relatórios gerenciais' },
};

export default function Header() {
  const { pathname } = useLocation();
  const meta = pageTitles[pathname] || pageTitles['/'];

  return (
    <header className="app-header">
      <div className="header-left">
        <h1 className="header-title">{meta.title}</h1>
        {pathname !== '/' && <span className="header-subtitle">{meta.subtitle}</span>}
      </div>
      <div className="header-right">
        <button className="header-btn" aria-label="Perfil do usuário">Entrar</button>
        <div className="header-avatar" aria-label="Avatar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          </svg>
        </div>
      </div>
    </header>
  );
}
