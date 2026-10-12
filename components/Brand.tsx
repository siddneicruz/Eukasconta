import React, { useId } from 'react';
import { TICKET, APP_MARK_VIEWBOX, PD_MARK, PD_LOGO } from './brandPaths';

// Símbolo do Eu Kasconta: ticket dourado com cantos vazados, moldura, "K", picote e código de barras.
// Sem fundo: o ticket vale sozinho, em qualquer cor de tela.
export const AppMark: React.FC<{ className?: string; title?: string }> = ({ className = '', title }) => {
  const id = useId().replace(/:/g, '');
  const f = TICKET.frame;
  return (
    <svg viewBox={APP_MARK_VIEWBOX} className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`ek-${id}`} x1="0.12" y1="0" x2="0.88" y2="1">
          <stop offset="0" stopColor="#F7DE86" />
          <stop offset="0.5" stopColor="#D4AF37" />
          <stop offset="1" stopColor="#A9812A" />
        </linearGradient>
      </defs>
      <path d={TICKET.body} fill={`url(#ek-${id})`} />
      <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={f.r} fill="none" stroke={TICKET.cream} strokeWidth={f.sw} />
      <path d={TICKET.k} fill={TICKET.dark} />
      <line x1={TICKET.perf.x1} y1={TICKET.perf.y} x2={TICKET.perf.x2} y2={TICKET.perf.y} stroke={TICKET.cream} strokeWidth={4.5} strokeDasharray="11 8" strokeLinecap="round" />
      <path d={TICKET.bars} fill={TICKET.dark} />
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
