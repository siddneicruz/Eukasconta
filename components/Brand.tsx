import React, { useId } from 'react';
import { PD_MARK, PD_LOGO } from './brandPaths';

// Símbolo do Eu Kasconta (v2): cupom dourado com K, QR e base em zigue-zague, SEM caixa de fundo (transparente).
export const AppMark: React.FC<{ className?: string; title?: string; plate?: boolean }> = ({ className = '', title }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="64 56 384 400" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs><linearGradient id={`gx${id}`} x1="90" y1="75" x2="430" y2="445" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#F5DB88" /><stop offset="0.5" stopColor="#DDB94B" /><stop offset="1" stopColor="#B38A2B" /></linearGradient></defs>
      <path d="M88 75 H424 A8 8 0 0 1 432 83 V425 L424.0 445 L416.0 425 L408.0 445 L400.0 425 L392.0 445 L384.0 425 L376.0 445 L368.0 425 L360.0 445 L352.0 425 L344.0 445 L336.0 425 L328.0 445 L320.0 425 L312.0 445 L304.0 425 L296.0 445 L288.0 425 L280.0 445 L272.0 425 L264.0 445 L256.0 425 L248.0 445 L240.0 425 L232.0 445 L224.0 425 L216.0 445 L208.0 425 L200.0 445 L192.0 425 L184.0 445 L176.0 425 L168.0 445 L160.0 425 L152.0 445 L144.0 425 L136.0 445 L128.0 425 L120.0 445 L112.0 425 L104.0 445 L96.0 425 L88.0 445 L80.0 425 V83 A8 8 0 0 1 88 75 Z" fill={`url(#gx${id})`}/>
<g stroke="#1A1405" strokeLinecap="round" fill="none">
<line x1="175" y1="108" x2="337" y2="108" strokeWidth="18"/><line x1="195" y1="130" x2="317" y2="130" strokeWidth="10"/><line x1="177" y1="148" x2="336" y2="148" strokeWidth="10"/>
</g>
<g stroke="rgba(26,20,5,0.38)" strokeWidth="5" strokeDasharray="14 8" strokeLinecap="round"><line x1="104" y1="165" x2="404" y2="165"/><line x1="104" y1="339" x2="404" y2="339"/></g>
<g stroke="rgba(26,20,5,0.38)" strokeWidth="9" strokeLinecap="round"><line x1="108" y1="199" x2="157" y2="199"/><line x1="108" y1="224" x2="147" y2="224"/><line x1="108" y1="249" x2="161" y2="249"/><line x1="108" y1="274" x2="138" y2="274"/><line x1="108" y1="299" x2="157" y2="299"/><line x1="108" y1="324" x2="147" y2="324"/><line x1="351" y1="199" x2="403" y2="199"/><line x1="360" y1="224" x2="403" y2="224"/><line x1="346" y1="249" x2="403" y2="249"/><line x1="356" y1="274" x2="403" y2="274"/><line x1="360" y1="299" x2="403" y2="299"/><line x1="366" y1="324" x2="403" y2="324"/></g>
<g fill="#1A1405"><rect x="175" y="187" width="40" height="141"/><polygon points="205,258 300,173 326,203 232,283"/><polygon points="222,262 246,244 332,321 301,343"/><rect x="108.0" y="349.0" width="9.8" height="9.8"/><rect x="117.4" y="349.0" width="9.8" height="9.8"/><rect x="126.8" y="349.0" width="9.8" height="9.8"/><rect x="155.0" y="349.0" width="9.8" height="9.8"/><rect x="164.4" y="349.0" width="9.8" height="9.8"/><rect x="173.8" y="349.0" width="9.8" height="9.8"/><rect x="108.0" y="358.4" width="9.8" height="9.8"/><rect x="126.8" y="358.4" width="9.8" height="9.8"/><rect x="145.6" y="358.4" width="9.8" height="9.8"/><rect x="155.0" y="358.4" width="9.8" height="9.8"/><rect x="173.8" y="358.4" width="9.8" height="9.8"/><rect x="108.0" y="367.8" width="9.8" height="9.8"/><rect x="117.4" y="367.8" width="9.8" height="9.8"/><rect x="126.8" y="367.8" width="9.8" height="9.8"/><rect x="145.6" y="367.8" width="9.8" height="9.8"/><rect x="155.0" y="367.8" width="9.8" height="9.8"/><rect x="164.4" y="367.8" width="9.8" height="9.8"/><rect x="173.8" y="367.8" width="9.8" height="9.8"/><rect x="155.0" y="377.2" width="9.8" height="9.8"/><rect x="108.0" y="386.6" width="9.8" height="9.8"/><rect x="117.4" y="386.6" width="9.8" height="9.8"/><rect x="126.8" y="386.6" width="9.8" height="9.8"/><rect x="145.6" y="386.6" width="9.8" height="9.8"/><rect x="164.4" y="386.6" width="9.8" height="9.8"/><rect x="136.2" y="396.0" width="9.8" height="9.8"/><rect x="155.0" y="396.0" width="9.8" height="9.8"/><rect x="164.4" y="396.0" width="9.8" height="9.8"/><rect x="108.0" y="405.4" width="9.8" height="9.8"/><rect x="145.6" y="405.4" width="9.8" height="9.8"/><rect x="173.8" y="405.4" width="9.8" height="9.8"/><rect x="108.0" y="414.8" width="9.8" height="9.8"/><rect x="126.8" y="414.8" width="9.8" height="9.8"/><rect x="136.2" y="414.8" width="9.8" height="9.8"/><rect x="155.0" y="414.8" width="9.8" height="9.8"/><rect x="164.4" y="414.8" width="9.8" height="9.8"/><rect x="173.8" y="414.8" width="9.8" height="9.8"/></g>
<g stroke="#1A1405" strokeLinecap="round"><line x1="214" y1="362" x2="387" y2="362" strokeWidth="9"/><line x1="214" y1="382" x2="335" y2="382" strokeWidth="9"/><line x1="214" y1="403" x2="364" y2="403" strokeWidth="9"/></g>
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

const PD_LOGO_CUT = 476;

export const PDLogo: React.FC<{ className?: string; title?: string }> = ({ className = '', title = 'Projeto Design' }) => (
  // A logo original traz, abaixo do nome, a linha "Criação, Projeto, Desenhos Técnicos e Manuais"; o corte na altura 476 deixa só o hexágono e o nome.
  <svg viewBox={`0 0 ${PD_LOGO.w} ${PD_LOGO_CUT}`} className={className} fill="currentColor" fillRule="evenodd" role="img" aria-label={title}>
    <path d={PD_LOGO.d} />
  </svg>
);
