import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

const navItems = [
  { to: '/home', label: 'Home' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/mapa', label: 'Mapa' },
  { to: '/especies', label: 'Espécies' },
  { to: '/relatorios', label: 'Relatórios' },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/especies?busca=${encodeURIComponent(query.trim())}`);
      setQuery('');
      setOpen(false);
    }
  }

  return (
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

      <button
        className="header-menu-toggle"
        aria-label={open ? 'Fechar menu' : 'Abrir menu'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={`menu-bar ${open ? 'open' : ''}`} />
        <span className={`menu-bar ${open ? 'open' : ''}`} />
        <span className={`menu-bar ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <nav className="header-nav-mobile" aria-label="Navegação mobile">
          <form className="header-search header-search--mobile" onSubmit={handleSearch} role="search">
            <input
              type="search"
              className="header-search-input"
              placeholder="Buscar espécies, áreas..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar"
            />
          </form>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className="header-nav-link"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
          <button
            className="header-btn header-btn--mobile"
            type="button"
            onClick={() => { navigate('/dashboard'); setOpen(false); }}
          >
            Acessar dados
          </button>
        </nav>
      )}
    </header>
  );
}
