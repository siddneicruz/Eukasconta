import React, { useId } from 'react';
import { PD_MARK, PD_LOGO } from './brandPaths';

// Símbolo do Eu Kasconta (v2): cupom fiscal com base em zigue-zague e um K sólido.
// plate=false remove a placa escura (usa o fundo da tela).
export const AppMark: React.FC<{ className?: string; title?: string; plate?: boolean }> = ({ className = '', title, plate = true }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 108 108" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs><linearGradient id={`gx${id}`} x1="28" y1="18" x2="80" y2="92" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#F5DB88" /><stop offset="0.5" stopColor="#DDB94B" /><stop offset="1" stopColor="#B38A2B" /></linearGradient><radialGradient id={`glx${id}`} cx="0.5" cy="0.35" r="0.75"><stop offset="0" stopColor="#DDB94B" stopOpacity="0.22" /><stop offset="1" stopColor="#DDB94B" stopOpacity="0" /></radialGradient></defs>
      {plate && <>
        <rect width="108" height="108" rx="26" fill="#0C0B09" />
        <rect width="108" height="108" rx="26" fill={`url(#glx${id})`} />
        <rect x="1.5" y="1.5" width="105" height="105" rx="24.5" fill="none" stroke="#DDB94B" strokeOpacity="0.35" strokeWidth="1.2" />
      </>}
      <g transform="translate(54 54) scale(1.12) translate(-54 -54)"><path d="M31 19 H77 A2 2 0 0 1 79 21 V84.5 L76.50 90 L74.00 84.5 L71.50 90 L69.00 84.5 L66.50 90 L64.00 84.5 L61.50 90 L59.00 84.5 L56.50 90 L54.00 84.5 L51.50 90 L49.00 84.5 L46.50 90 L44.00 84.5 L41.50 90 L39.00 84.5 L36.50 90 L34.00 84.5 L31.50 90 L29.00 84.5 V21 A2 2 0 0 1 31 19 Z" fill={`url(#gx${id})`} /><g stroke="#17120A" strokeWidth="7.4" fill="none"><line x1="43.5" y1="32" x2="43.5" y2="71" /><line x1="47" y1="53.5" x2="65.5" y2="33.5" /><line x1="52.5" y1="50" x2="67.5" y2="71" /></g><line x1="37" y1="78.5" x2="71" y2="78.5" stroke="#17120A" strokeOpacity="0.55" strokeWidth="1.8" strokeDasharray="3.6 3.2" strokeLinecap="round" /></g>
    </svg>
  );
};

// Nome da marca: EU KASCONTA (Cinzel 700, espaçamento .14em) com o K em ouro.
export const BrandName: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`font-serif font-bold tracking-[0.14em] whitespace-nowrap ${className}`}>EU <span className="text-luxury-gold">K</span>ASCONTA</span>
);

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
