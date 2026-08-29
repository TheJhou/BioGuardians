import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="mapa" element={<MapPage />} />
          <Route path="especies" element={<SpeciesPage />} />
          <Route path="especies/:id" element={<SpeciesPage />} />
          <Route path="unidades-conservacao" element={<div className="page-placeholder">Unidades de Conservação</div>} />
          <Route path="ocorrencias" element={<div className="page-placeholder">Ocorrências</div>} />
          <Route path="relatorios" element={<div className="page-placeholder">Relatórios</div>} />
          <Route path="sobre" element={<div className="page-placeholder">Sobre</div>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
