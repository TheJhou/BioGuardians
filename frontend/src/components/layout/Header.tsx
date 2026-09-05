import { useState } from 'react';
import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/home', label: 'Home' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/mapa', label: 'Mapa' },
  { to: '/especies', label: 'Espécies' },
  { to: '/relatorios', label: 'Relatórios' },
];

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="app-header">
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
        </nav>
      )}
    </header>
  );
}
