import { NavLink, useLocation } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/mapa', label: 'Mapa' },
  { to: '/especies', label: 'Espécies' },
  { to: '/unidades-conservacao', label: 'Unidades de Conservação' },
  { to: '/ocorrencias', label: 'Ocorrências' },
  { to: '/relatorios', label: 'Relatórios' },
];

const footerItems = [
  { to: '/sobre', label: 'Sobre' },
];

export default function Sidebar() {
  const { pathname } = useLocation();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12 2C7.5 4 4 8 4 13c0 4.5 3.5 8 8 8s8-3.5 8-8c0-5-3.5-9-8-11z" fill="#16A36A"/>
            <path d="M12 6c-2.5 1.5-4 4-4 7 0 3 1.5 5.5 4 6.5V6z" fill="#9AD84B"/>
          </svg>
        </div>
        <span className="brand-name">BioGuardians</span>
      </div>
      <nav className="sidebar-nav" aria-label="Menu principal">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={`sidebar-link ${pathname === item.to || pathname.startsWith(`${item.to}/`) ? 'active' : ''}`}
            end={item.to === '/'}
          >
            <span className="sidebar-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        {footerItems.map((item) => (
          <NavLink key={item.to} to={item.to} className="sidebar-link">
            <span className="sidebar-label">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </aside>
  );
}
