import React, { useEffect, useState } from 'react';

// Formatos compactos para os eixos dos gráficos: "R$ 1.500" vira "R$ 1,5 mil" e cabe sem cortar no celular.

const trim1 = (n: number) => n.toFixed(1).replace('.', ',').replace(/,0$/, '');

export const brlAxis = (value: number | string): string => {
  const n = Number(value);
  if (!isFinite(n)) return '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `R$ ${trim1(n / 1_000_000)} mi`;
  if (a >= 1_000) return `R$ ${trim1(n / 1_000)} mil`;
  return `R$ ${Math.round(n)}`;
};

// Cores e tamanhos dos textos dos eixos (mín. 11 px, contraste legível no fundo preto).
export const axisTickX = { fill: '#a1a1aa', fontSize: 11, fontWeight: 600 } as const;
export const axisTickY = { fill: '#8b8b95', fontSize: 11 } as const;
export const AXIS_Y_WIDTH = 68;

// Desenha o valor do eixo Y numa linha só (o texto padrão do Recharts quebra "R$ 4,5 mil" em duas linhas).
export const renderYTick = (props: any) => {
  const { x, y, payload } = props;
  return (
    <text x={Number(x) - 4} y={Number(y)} dy={4} textAnchor="end" fill={axisTickY.fill} fontSize={axisTickY.fontSize}>
      {brlAxis(payload?.value)}
    </text>
  );
};

/* ───────────── linha do tempo fina (Início e Relatórios) ───────────── */

// Letra de 10 px e eixo Y mais estreito que nos outros gráficos.
export const TL_AXIS_Y_WIDTH = 56;
export const TL_MARGIN_RIGHT = 18;
export const TL_TICK = { fill: '#8b8b95', fontSize: 10, fontWeight: 500 } as const;

// Rótulo do eixo X, centrado no ponto (a margem direita do gráfico deixa o último inteiro dentro do cartão).
export const renderTimelineTick = (props: any) => {
  const { x, y, payload } = props;
  return (
    <text x={Number(x)} y={Number(y)} dy={12} textAnchor="middle" fill={TL_TICK.fill} fontSize={TL_TICK.fontSize} fontWeight={TL_TICK.fontWeight}>
      {String(payload?.value ?? '')}
    </text>
  );
};

// Valor do eixo Y numa linha só, em 10 px.
export const renderTimelineYTick = (props: any) => {
  const { x, y, payload } = props;
  return (
    <text x={Number(x) - 2} y={Number(y)} dy={3.5} textAnchor="end" fill={TL_TICK.fill} fontSize={TL_TICK.fontSize}>
      {brlAxis(payload?.value)}
    </text>
  );
};

// Largura do gráfico em px (acompanha girar o celular e mudar o tamanho da janela).
export const useElementWidth = (ref: React.RefObject<HTMLElement | null>, fallback = 300): number => {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.round(el.clientWidth) || fallback);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return w;
};
