import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout.js';
import HomePage from './pages/HomePage.js';
import MapPage from './pages/MapPage.js';
import DashboardPage from './pages/DashboardPage.js';
import SpeciesPage from './pages/SpeciesPage.js';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="mapa" element={<MapPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="especies" element={<SpeciesPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
