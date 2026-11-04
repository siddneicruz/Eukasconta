/* "Bip" de leitura de código de barras: dois tons curtos (como o leitor do caixa) + vibração. Sem arquivo de som. */
let ctx: AudioContext | null = null;
export const beepOk = () => {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (AC) {
      ctx = ctx || new AC();
      const c = ctx!; if (c.state === 'suspended') c.resume();
      [[1568, 0], [2093, 0.09]].forEach(([f, t]) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'square'; o.frequency.value = f;
        const at = c.currentTime + t;
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.25, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
        o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.09);
      });
    }
  } catch { /* sem áudio */ }
  try { navigator.vibrate?.(40); } catch { /* sem vibração */ }
};
