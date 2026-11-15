// Modo leve: em aparelho fraco (poucos núcleos/pouca memória) ou com "reduzir movimento" ligado,
// o app tira o desfoque de fundo (o item mais pesado de desenhar) e deixa as barras fixas opacas.
// Quem quiser forçar: localStorage eukasconta_lite = '1' (liga) ou '0' (desliga).
export function isWeakDevice(): boolean {
  try {
    const f = localStorage.getItem('eukasconta_lite');
    if (f === '1') return true;
    if (f === '0') return false;
  } catch { /* sem armazenamento: segue a detecção */ }
  const n = navigator as any;
  const cores = n.hardwareConcurrency;
  const mem = n.deviceMemory;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return !!((cores && cores <= 4) || (mem && mem <= 3) || reduce);
}

export function installLiteMode() {
  if (isWeakDevice()) document.documentElement.classList.add('ek-lite');
}
