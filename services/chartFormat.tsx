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
