import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

const navItems = [
  { to: '/home', label: 'Home' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/mapa', label: 'Mapa' },
  { to: '/especies', label: 'Espécies' },
  { to: '/relatorios', label: 'Relatórios' },
];

const bottomNavItems: { to: string; label: string; icon: () => ReactNode }[] = [
  { to: '/home', label: 'Home', icon: HomeIcon },
  { to: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
  { to: '/mapa', label: 'Mapa', icon: MapIcon },
  { to: '/especies', label: 'Espécies', icon: SpeciesIcon },
  { to: '/relatorios', label: 'Relatórios', icon: ReportsIcon },
];

function HomeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

function SpeciesIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a4 4 0 0 0-4 4c0 2.5 2 4 4 6.5 2-2.5 4-4 4-6.5a4 4 0 0 0-4-4z" />
      <path d="M12 12c-3.5 0-6 2.5-6 6v4h12v-4c0-3.5-2.5-6-6-6z" />
    </svg>
  );
}

function ReportsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

export default function Header() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/especies?busca=${encodeURIComponent(query.trim())}`);
      setQuery('');
    }
  }

  return (
    <>
      <header className="app-header app-header--dark">
        <div className="header-brand">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12 2C7.5 4 4 8 4 13c0 4.5 3.5 8 8 8s8-3.5 8-8c0-5-3.5-9-8-11z" fill="#16A36A"/>
            <path d="M12 6c-2.5 1.5-4 4-4 7 0 3 1.5 5.5 4 6.5V6z" fill="#9AD84B"/>
          </svg>
          <span className="brand-name">BioGuardians</span>
        </div>

        <nav className="header-nav" aria-label="Navegação principal">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className="header-nav-link">
              {item.label}
            </NavLink>
          ))}
        </nav>

        <form className="header-search" onSubmit={handleSearch} role="search">
          <input
            type="search"
            className="header-search-input"
            placeholder="Buscar espécies, áreas..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar"
          />
        </form>

        <div className="header-right">
          <button className="header-btn" type="button" onClick={() => navigate('/dashboard')}>
            Acessar dados
          </button>
        </div>
      </header>

      <nav className="bottom-nav" aria-label="Navegação mobile">
        {bottomNavItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className="bottom-nav-link">
            {item.icon()}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
