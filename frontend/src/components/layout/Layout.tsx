import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header.js';

export default function Layout() {
  const { pathname } = useLocation();
  const isHome = pathname === '/' || pathname === '/home';

  return (
    <div className="app-layout">
      {!isHome && <Header />}
      <main className="page-main">
        <Outlet />
      </main>
    </div>
  );
}
