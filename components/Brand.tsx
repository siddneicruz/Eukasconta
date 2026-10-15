import React, { useId } from 'react';
import { TICKET, PD_MARK, PD_LOGO } from './brandPaths';

// Símbolo do Eu Kasconta: o mesmo ícone do app no celular, um quadrado dourado com moldura, "K", picote e
// código de barras (cantos arredondados e sem nenhum fundo escuro por trás).
export const AppMark: React.FC<{ className?: string; title?: string }> = ({ className = '', title }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 108 108" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`ek-${id}`} gradientUnits="userSpaceOnUse" x1="13" y1="0" x2="95" y2="108">
          <stop offset="0" stopColor="#F7DE86" />
          <stop offset="0.5" stopColor="#D4AF37" />
          <stop offset="1" stopColor="#A9812A" />
        </linearGradient>
      </defs>
      <rect width="108" height="108" rx="24" fill={`url(#ek-${id})`} />
      <g transform="translate(54 54) scale(.92) translate(-54 -54)">
        <rect x="16" y="14" width="76" height="54" rx="3.2" fill="none" stroke={TICKET.cream} strokeWidth="2.6" />
        <path d={TICKET.k} transform="translate(21.9 7.19) scale(.214)" fill={TICKET.dark} />
        <line x1="11" y1="77.5" x2="97" y2="77.5" stroke={TICKET.cream} strokeWidth="2.2" strokeDasharray="4.6 3.4" strokeLinecap="round" />
        <path d={TICKET.bars} transform="translate(9 16.4) scale(.30 .1917)" fill={TICKET.dark} />
      </g>
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
