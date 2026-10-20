/* Teclado na tela. No Android 15 o app é desenhado por baixo das barras do sistema e o teclado fica POR CIMA dele
   (a janela do app não encolhe). As folhas coladas embaixo — "Adicionar item", editar quantidade, buscar... — sumiam
   atrás do teclado. Quando um campo de texto dentro de uma folha recebe foco, a folha sobe para o topo e a altura dela
   passa a caber na parte que continua visível (as regras de CSS ficam no index.html, sob a classe `kb-open`). */

const MODAL = '[role="dialog"][aria-modal="true"]';
const TEXT_TYPES = new Set(['', 'text', 'search', 'number', 'tel', 'email', 'url', 'password']);
/** Parte da altura que sobra acima do teclado quando o aparelho não avisa o tamanho dele (teclado ≈ 36–42%). */
const FALLBACK_VISIBLE = 0.54;

export const isTextField = (el: Element | null): el is HTMLElement => {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return TEXT_TYPES.has(((el as HTMLInputElement).type || '').toLowerCase());
  return (el as HTMLElement).isContentEditable === true;
};

export const installKeyboardAvoid = (): (() => void) => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !window.matchMedia) return () => {};
  const root = document.documentElement;
  let baseH = window.innerHeight;
  let on = false;
  let watch: ReturnType<typeof setInterval> | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

  // só celular: no computador não existe teclado na tela
  const touchPhone = () => window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(max-width: 639px)').matches;
  const activeField = (): HTMLElement | null => {
    const a = document.activeElement;
    return touchPhone() && isTextField(a) && a.closest(MODAL) ? a : null;
  };

  const clear = () => {
    if (!on) return;
    on = false;
    root.classList.remove('kb-open');
    root.style.removeProperty('--kb-visible');
    if (watch) { clearInterval(watch); watch = null; }
  };

  const measure = () => {
    if (!activeField()) return;
    const vv = window.visualViewport;
    const seen = Math.min(window.innerHeight, vv ? vv.height : window.innerHeight);
    baseH = Math.max(baseH, window.innerHeight);
    // o aparelho avisou (a janela ou a área visível encolheu) ou não avisou (estima)
    const visible = seen < baseH - 120 ? seen : Math.round(baseH * FALLBACK_VISIBLE);
    root.style.setProperty('--kb-visible', `${Math.max(180, visible)}px`);
    if (!on) {
      on = true;
      root.classList.add('kb-open');
      // a folha apagou o campo (fechou) ou o foco saiu: confere de vez em quando
      watch = setInterval(() => { if (!activeField()) clear(); }, 400);
    }
  };

  const onFocusIn = () => {
    if (!activeField()) return;
    // só depois do toque terminar: se a folha pulasse para o topo no meio do toque, o "clique" cairia fora dela e a fecharia
    later(measure, 160);
    later(() => { measure(); try { activeField()?.scrollIntoView({ block: 'nearest' }); } catch { /* sem scrollIntoView */ } }, 380);
    later(measure, 800);
  };
  // saiu do campo: espera um pouco antes de descer a folha, para o toque num botão da folha não "fugir" do dedo
  const onFocusOut = () => later(() => { if (!activeField()) clear(); }, 350);
  const onResize = () => { if (on) measure(); else baseH = Math.max(baseH, window.innerHeight); };

  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  return () => {
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    timers.forEach(clearTimeout); timers.clear();
    clear();
  };
};
