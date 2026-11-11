/* Confere se a foto de um cupom tem qualidade para a IA ler: não pode estar em branco/estourada pela luz,
   escura demais nem borrada. Medido numa cópia pequena (600 px de largura), tudo no aparelho.
   Os limites foram calibrados com um cupom bom (borda forte em ~8–11% dos pixels), o mesmo cupom desfocado
   (0–0,6%) e uma página branca estourada de flash (0%). */

export type QualityVerdict = { ok: boolean; reason?: 'blank' | 'dark' | 'blurry'; message?: string };

const MSG = {
  blank: 'a página saiu em branco ou estourada pela luz (afaste um pouco o celular do papel ou ligue/desligue o flash)',
  dark: 'a foto ficou escura (ligue o flash no ícone de raio do scanner ou procure mais luz)',
  blurry: 'o texto ficou borrado (segure firme, deixe o celular parar de mexer e espere o foco antes de capturar)',
} as const;

export const judgeGray = (gray: Uint8ClampedArray | number[], w: number, h: number): QualityVerdict => {
  const n = w * h;
  if (n < 1000) return { ok: true };
  let sum = 0, ink = 0;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) { const v = gray[i]; sum += v; hist[v]++; if (v < 110) ink++; }
  const mean = sum / n;
  const pct = (p: number) => { let acc = 0; const target = n * p; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; } return 255; };
  const contrast = pct(0.95) - pct(0.05);
  if (mean < 70) return { ok: false, reason: 'dark', message: MSG.dark };
  if (ink / n < 0.004 || contrast < 60) return { ok: false, reason: 'blank', message: MSG.blank };
  let strong = 0, cnt = 0;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x;
    if (Math.abs(gray[i + 1] - gray[i]) > 40) strong++;
    if (Math.abs(gray[i + w] - gray[i]) > 40) strong++;
    cnt += 2;
  }
  if (strong / cnt < 0.012) return { ok: false, reason: 'blurry', message: MSG.blurry };
  return { ok: true };
};

export const checkScanQuality = async (file: File): Promise<QualityVerdict> => {
  try {
    const bmp = await createImageBitmap(file);
    const w = 600, h = Math.max(1, Math.round((bmp.height * w) / bmp.width));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: true };
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const px = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) gray[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    return judgeGray(gray, w, h);
  } catch {
    return { ok: true }; // não deu para medir: deixa passar, a leitura da IA continua valendo
  }
};
