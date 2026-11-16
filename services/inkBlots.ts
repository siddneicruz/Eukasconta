/* Manchas de tinta (óleo/leite) desenhadas por código, de borda NÍTIDA, usadas como máscara na troca de tema.
   Três estilos, para a chuva não parecer carimbo repetido:
     0 "pingo"    — gota redonda e brilhante com jatos longos que terminam em bulbo, e gotículas
     1 "respingo" — corpo irregular, rastros finos e uma nuvem de pontinhos de tamanhos muito diferentes
     2 "vazada"   — corpo de lóbulos com buracos por dentro, borda recortada e pontinhos em volta
   Cada imagem é desenhada UMA vez; depois só é esticada. */

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
type Ctx = CanvasRenderingContext2D;

const disc = (g: Ctx, x: number, y: number, r: number) => { g.beginPath(); g.arc(x, y, Math.max(0.4, r), 0, Math.PI * 2); g.fill(); };

/** "Gosma": borra as formas desenhadas e corta seco no meio do cinza — círculos vizinhos viram UMA mancha de contorno
 *  liso e orgânico, jatos ganham pescoço arredondado. O resultado final não tem degradê: só dentro/fora, com meio
 *  pixel de suavização para a borda não ficar em degraus. */
const goo = (g: Ctx, blur: number) => {
  const c = g.canvas, W = c.width, H = c.height;
  const t = document.createElement('canvas'); t.width = W; t.height = H;
  const tg = t.getContext('2d'); if (!tg) return;
  let ok = true;
  try { tg.filter = `blur(${blur}px)`; } catch { ok = false; }
  tg.drawImage(c, 0, 0);
  if (!ok) return;                                   // sem filtro no aparelho: mantém as formas como foram desenhadas
  const im = tg.getImageData(0, 0, W, H), d = im.data;
  const lo = 124, hi = 132;                          // faixa estreita: borda seca, só com meio pixel de suavização
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i];
    d[i] = a <= lo ? 0 : a >= hi ? 255 : Math.round(((a - lo) / (hi - lo)) * 255);
    d[i - 1] = 0; d[i - 2] = 0; d[i - 3] = 0;
  }
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.putImageData(im, 0, 0); g.restore();
};

/** Jato curvo que afina até a ponta; com `bulb`, termina numa gota (como pingo escorrendo). */
const tail = (g: Ctx, cx: number, cy: number, ang: number, from: number, len: number, w0: number, bulb: number, curve: number) => {
  const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
  const p0 = [cx + ux * from, cy + uy * from];
  const p1 = [cx + ux * (from + len * 0.5) + nx * curve * len, cy + uy * (from + len * 0.5) + ny * curve * len];
  const p2 = [cx + ux * (from + len) + nx * curve * len * 0.6, cy + uy * (from + len) + ny * curve * len * 0.6];
  const steps = Math.max(8, Math.ceil(len / 1.4));
  for (let i = 0; i <= steps; i++) {
    const s = i / steps, a = (1 - s) * (1 - s), b = 2 * (1 - s) * s, c = s * s;
    const x = a * p0[0] + b * p1[0] + c * p2[0], y = a * p0[1] + b * p1[1] + c * p2[1];
    const base = w0 * Math.pow(1 - s, 1.25);
    // o pescoço fino antes do bulbo, como numa gota que escorre
    const r = bulb > 0 ? Math.max(w0 * 0.28 * (1 - s) + 0.8, base * 0.55) : Math.max(0.7, base);
    disc(g, x, y, r);
  }
  if (bulb > 0) disc(g, p2[0], p2[1], bulb);
  return p2;
};

/** Nuvem de pontinhos: muitos minúsculos, poucos grandes (tamanho em potência), mais densos perto da mancha. */
const specks = (g: Ctx, cx: number, cy: number, r0: number, r1: number, n: number, scale: number) => {
  for (let k = 0; k < n; k++) {
    const t = Math.random() * Math.PI * 2, d = r0 + (r1 - r0) * Math.pow(Math.random(), 1.6);
    const u = Math.random(), rr = (0.9 + 11 * u * u * u) * scale;
    disc(g, cx + Math.cos(t) * d, cy + Math.sin(t) * d, rr);
  }
};

/** Corpo de lóbulos: vários círculos de tamanhos diferentes sobrepostos ao redor do centro. */
const lumpy = (g: Ctx, cx: number, cy: number, R: number, lobes: number, minR: number, maxR: number) => {
  disc(g, cx, cy, R * 0.62);
  for (let k = 0; k < lobes; k++) {
    const t = Math.random() * Math.PI * 2, d = R * Math.pow(Math.random(), 0.55) * 0.95;
    disc(g, cx + Math.cos(t) * d, cy + Math.sin(t) * d, rnd(minR, maxR));
  }
};

const style0 = (g: Ctx, N: number) => {            // pingo brilhante com jatos
  const cx = N / 2, cy = N / 2, R = N * 0.2, s = N / 1024;
  lumpy(g, cx, cy, R * 0.9, 12, R * 0.3, R * 0.55);
  disc(g, cx, cy, R * 0.92);
  const nt = 8 + Math.floor(Math.random() * 3);
  const drips: { ang: number; len: number; w: number; bulb: number; curve: number }[] = [];
  for (let k = 0; k < nt; k++) {
    const ang = (k / nt) * Math.PI * 2 + rnd(-0.28, 0.28);
    const long = Math.random() < 0.55;
    const len = (long ? rnd(0.16, 0.3) : rnd(0.06, 0.14)) * N;
    if (long) drips.push({ ang, len, w: rnd(0.03, 0.05) * N, bulb: rnd(0.018, 0.03) * N, curve: rnd(-0.18, 0.18) });   // com bulbo: depois da fusão, para a ponta não sumir
    else tail(g, cx, cy, ang, R * 0.85, len, rnd(0.036, 0.06) * N, 0, rnd(-0.18, 0.18));
  }
  for (let k = 0; k < 4; k++) {               // agulhas mais finas
    tail(g, cx, cy, Math.random() * Math.PI * 2, R * 0.9, rnd(0.2, 0.34) * N, rnd(7, 11) * s, 0, rnd(-0.05, 0.05));
  }
  goo(g, 11 * s);
  drips.forEach(d => tail(g, cx, cy, d.ang, R * 0.85, d.len, d.w, d.bulb, d.curve));
  for (let k = 0; k < 9; k++) {               // gotas soltas logo depois das pontas
    const ang = Math.random() * Math.PI * 2, d = R * rnd(1.5, 2.3);
    disc(g, cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, rnd(3, 11) * s);
  }
  specks(g, cx, cy, R * 1.2, N * 0.46, 26, s);
};

const style1 = (g: Ctx, N: number) => {            // respingo com nuvem de pontinhos
  const cx = N / 2, cy = N / 2, R = N * 0.21, s = N / 1024;
  lumpy(g, cx, cy, R, 30, R * 0.12, R * 0.34);
  const ns = 14 + Math.floor(Math.random() * 6);
  for (let k = 0; k < ns; k++) {               // rastros tortos, grossos na base e finos na ponta
    const ang = Math.random() * Math.PI * 2;
    tail(g, cx, cy, ang, R * rnd(0.6, 0.95), rnd(0.08, 0.26) * N, rnd(11, 26) * s, 0, rnd(-0.22, 0.22));
  }
  for (let k = 0; k < 7; k++) {                // manchinhas soltas, cada uma com 2–4 lóbulos
    const t = Math.random() * Math.PI * 2, d = R * rnd(1.35, 2.15);
    const x = cx + Math.cos(t) * d, y = cy + Math.sin(t) * d, r = rnd(9, 28) * s;
    disc(g, x, y, r);
    for (let j = 0; j < 3; j++) disc(g, x + rnd(-r, r), y + rnd(-r, r), r * rnd(0.45, 0.85));
  }
  goo(g, 9 * s);
  specks(g, cx, cy, R * 1.05, N * 0.48, 110, s * 0.9);
};

const style2 = (g: Ctx, N: number) => {            // corpo vazado com buracos e borda recortada
  const cx = N / 2, cy = N / 2, R = N * 0.2, s = N / 1024;
  lumpy(g, cx, cy, R, 22, R * 0.2, R * 0.46);
  // borda recortada: correntes de círculos pequenos encostados no contorno (a gosma funde com o corpo)
  const ring = 36 + Math.floor(Math.random() * 14);
  for (let k = 0; k < ring; k++) {
    const t = (k / ring) * Math.PI * 2 + rnd(-0.05, 0.05), d = R * rnd(0.98, 1.3);
    disc(g, cx + Math.cos(t) * d, cy + Math.sin(t) * d, rnd(9, 26) * s);
  }
  const ns = 8 + Math.floor(Math.random() * 5);
  for (let k = 0; k < ns; k++) {               // pontas curtas
    tail(g, cx, cy, Math.random() * Math.PI * 2, R * 1.0, rnd(0.07, 0.17) * N, rnd(14, 26) * s, 0, rnd(-0.12, 0.12));
  }
  goo(g, 10 * s);
  // buracos por dentro (apagam a mancha: aparece o tema antigo)
  g.save(); g.globalCompositeOperation = 'destination-out';
  const nh = 3 + Math.floor(Math.random() * 4);
  for (let k = 0; k < nh; k++) {
    const t = Math.random() * Math.PI * 2, d = R * rnd(0.05, 0.62), x = cx + Math.cos(t) * d, y = cy + Math.sin(t) * d, r = rnd(9, 30) * s;
    disc(g, x, y, r); if (Math.random() < 0.6) disc(g, x + rnd(-r, r), y + rnd(-r, r), r * 0.55);
  }
  g.restore();
  specks(g, cx, cy, R * 1.25, N * 0.47, 70, s);
};

const STYLES = [style0, style1, style2];

export const makeInkBlots = (N = 1024): string[] => {
  const out: string[] = [];
  const turn = Math.random() * Math.PI * 2;
  for (const draw of STYLES) {
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const g = c.getContext('2d');
    if (!g) throw new Error('sem canvas');
    g.fillStyle = '#000';
    g.translate(N / 2, N / 2); g.rotate(turn + Math.random() * Math.PI * 2); g.translate(-N / 2, -N / 2);
    draw(g, N);
    out.push(c.toDataURL('image/png'));
  }
  return out;
};
