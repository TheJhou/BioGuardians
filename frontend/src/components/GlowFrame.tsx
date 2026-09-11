import './GlowFrame.css';
import GlowLayers from '../lib/glow/index.js';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

export default function GlowFrame({ children, className = '' }: Props) {
  return (
    <div className={`gfx gframe ${className}`.trim()}>
      <GlowLayers />
      <div className="gframe-content">{children}</div>
    </div>
  );
}
