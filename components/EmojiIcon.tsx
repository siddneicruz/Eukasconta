import React from 'react';

/* Ícone feito de emoji, no mesmo formato dos ícones de traço (recebe className com w-/h-): desenhado dentro de um SVG para acompanhar o tamanho da caixa. */
const cache = new Map<string, React.FC<any>>();

export const emojiIconFor = (emoji: string): React.FC<any> => {
  let c = cache.get(emoji);
  if (!c) {
    c = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
      <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true" data-emoji-icon="1">
        <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central" fontSize="19">{emoji}</text>
      </svg>
    );
    cache.set(emoji, c);
  }
  return c;
};
