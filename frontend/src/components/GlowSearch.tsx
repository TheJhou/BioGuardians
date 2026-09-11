import './GlowSearch.css';
import GlowLayers from '../lib/glow/index.js';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
}

export default function GlowSearch({ value, onChange, onFocus, onKeyDown, placeholder = 'Search...' }: Props) {
  return (
    <div className="gfx gsearch">
      <GlowLayers />
      <div className="gsearch-main">
        <input
          type="text"
          className="gsearch-input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
        />
        <div className="gsearch-accent-mask" />
        <div className="gsearch-search-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" fill="none">
            <circle stroke="url(#gsearch-grad)" r="8" cy="11" cx="11" />
            <line stroke="url(#gsearch-gradl)" y2="16.65" y1="22" x2="16.65" x1="22" />
            <defs>
              <linearGradient gradientTransform="rotate(50)" id="gsearch-grad">
                <stop style={{ stopColor: 'var(--green-light)' }} offset="0%" />
                <stop style={{ stopColor: 'var(--green-accent)' }} offset="50%" />
              </linearGradient>
              <linearGradient id="gsearch-gradl">
                <stop style={{ stopColor: 'var(--green-accent)' }} offset="0%" />
                <stop style={{ stopColor: 'var(--green-primary)' }} offset="50%" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
    </div>
  );
}
