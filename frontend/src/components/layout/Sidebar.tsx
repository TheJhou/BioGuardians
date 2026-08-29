import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Início', icon: '🏠' },
  { to: '/mapa', label: 'Mapa', icon: '🗺️' },
  { to: '/especies', label: 'Espécies', icon: '🐆' },
  { to: '/unidades-conservacao', label: 'Unidades de Conservação', icon: '🌳' },
  { to: '/ocorrencias', label: 'Ocorrências', icon: '📍' },
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-icon">🌿</span>
        <span className="brand-name">BioGuardians</span>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} className="sidebar-link" end={item.to === '/'}>
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <NavLink to="/relatorios" className="sidebar-link">
          <span className="sidebar-icon">📄</span>
          <span className="sidebar-label">Relatórios</span>
        </NavLink>
        <NavLink to="/sobre" className="sidebar-link">
          <span className="sidebar-icon">ℹ️</span>
          <span className="sidebar-label">Sobre</span>
        </NavLink>
      </div>
    </aside>
  );
}
