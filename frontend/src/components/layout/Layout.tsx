import { Outlet } from 'react-router-dom';
import Header from './Header.js';
import Sidebar from './Sidebar.js';

export default function Layout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-content">
        <Header />
        <main className="page-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
