import React, { useId } from 'react';
import { APP_MARK_PATH, APP_MARK_VIEWBOX, PD_MARK, PD_LOGO } from './brandPaths';

// Símbolo do Eu Kasconta: cupom dourado (borda serrilhada) com um "K" em estêncil vazado.
export const AppMark: React.FC<{ className?: string; title?: string }> = ({ className = '', title }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox={APP_MARK_VIEWBOX} className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`ek-${id}`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#F3D676" />
          <stop offset="0.55" stopColor="#D4AF37" />
          <stop offset="1" stopColor="#A9812A" />
        </linearGradient>
      </defs>
      <path d={APP_MARK_PATH} fill={`url(#ek-${id})`} fillRule="evenodd" />
    </svg>
  );
};

// Logomarca da Projeto Design (criadora do app). Usa a cor do texto (currentColor).
export const PDMark: React.FC<{ className?: string; title?: string }> = ({ className = '', title }) => (
  <svg viewBox={`0 0 ${PD_MARK.w} ${PD_MARK.h}`} className={className} fill="currentColor" fillRule="evenodd" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
    <path d={PD_MARK.d} />
  </svg>
);

export const PDLogo: React.FC<{ className?: string; title?: string }> = ({ className = '', title = 'Projeto Design' }) => (
  <svg viewBox={`0 0 ${PD_LOGO.w} ${PD_LOGO.h}`} className={className} fill="currentColor" fillRule="evenodd" role="img" aria-label={title}>
    <path d={PD_LOGO.d} />
  </svg>
);
