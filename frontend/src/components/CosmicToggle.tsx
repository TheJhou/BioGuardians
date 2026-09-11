interface CosmicToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

// Toggle animado "cósmico" — usado nos controles de camadas do mapa
export default function CosmicToggle({ checked, onChange }: CosmicToggleProps) {
  return (
    <label className="cosmic-toggle">
      <input
        className="toggle"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="slider">
        <div className="cosmos" />
        <div className="energy-line" />
        <div className="energy-line" />
        <div className="energy-line" />
        <div className="toggle-orb">
          <div className="inner-orb" />
          <div className="ring" />
        </div>
        <div className="particles">
          <div className="particle" />
          <div className="particle" />
          <div className="particle" />
          <div className="particle" />
          <div className="particle" />
          <div className="particle" />
        </div>
      </div>
    </label>
  );
}
