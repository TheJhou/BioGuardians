import { Outlet } from 'react-router-dom';
import Header from './Header.js';

export default function Layout() {
  return (
    <div className="app-layout">
      <Header />
      <main className="page-main">
        <Outlet />
      </main>
    </div>
  );
}
