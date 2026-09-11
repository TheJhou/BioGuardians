import './GlowButton.css';
import GlowLayers from '../lib/glow/index.js';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  type?: 'button' | 'submit';
}

export default function GlowButton({ children, onClick, className = '', type = 'button' }: Props) {
  return (
    <div className={`gfx gbtn ${className}`.trim()}>
      <GlowLayers />
      <button type={type} className="gbtn-btn" onClick={onClick}>{children}</button>
    </div>
  );
}
