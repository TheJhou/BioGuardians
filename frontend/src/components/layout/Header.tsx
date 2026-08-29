import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="app-header">
      <div className="header-left">
        <h1 className="header-title">BioGuardians</h1>
        <span className="header-subtitle">Monitoramento da Biodiversidade Brasileira</span>
      </div>
      <div className="header-right">
        <button className="header-btn">Entrar</button>
      </div>
    </header>
  );
}
