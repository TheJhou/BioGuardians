import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header.js';

export default function Layout() {
  const { pathname } = useLocation();
  const isHome = pathname === '/' || pathname === '/home';
  const isMap = pathname === '/mapa';

  return (
    <div className="app-layout">
      {!isHome && !isMap && <Header />}
      <main className="page-main">
        <Outlet />
      </main>
    </div>
  );
}
