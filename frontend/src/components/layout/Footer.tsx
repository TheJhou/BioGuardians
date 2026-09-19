import iconPage from '../../images/icon-page.png';

export default function Footer() {
  return (
    <footer className="app-footer">
      <div className="app-footer-inner container">
        <span><img className="app-footer-logo" src={iconPage} alt="" width="16" height="16" /> BioGuardians · Dados abertos. Natureza viva.</span>
        <span>Ciência · Conservação · Tecnologia · Brasil</span>
      </div>
    </footer>
  );
}
