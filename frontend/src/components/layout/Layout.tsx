import { Outlet } from 'react-router-dom';
import Header from './Header.js';
import Footer from './Footer.js';

export default function Layout() {
  return (
    <div className="app-layout">
      <Header />
      <main className="page-main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
