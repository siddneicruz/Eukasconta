import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';

/* Seta fina para voltar ao topo: aparece no canto direito, logo abaixo da barra de filtros, enquanto a tela está sendo rolada
   (depois de descer um pouco) e some sozinha um instante depois que a rolagem para. Um toque leva direto ao topo, sem paradas. */
export default function ScrollUpButton({ resetKey }: { resetKey?: string }) {
  const [show, setShow] = useState(false);
  const [top, setTop] = useState(200);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const main = document.querySelector('.app-main') as HTMLElement | null;
    mainRef.current = main;
    setShow(false);
    if (!main) return;
    let timer: any;
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        clearTimeout(timer);
        if (main.scrollTop < 300) { setShow(false); return; }
        // fica logo abaixo da barra de filtros fixa (se houver) ou do cabeçalho
        const head = document.querySelector('.app-header') as HTMLElement | null;
        let t = Math.max(main.getBoundingClientRect().top, head ? head.getBoundingClientRect().bottom : 0);
        const base = t;
        main.querySelectorAll<HTMLElement>('.sticky').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width > main.clientWidth * 0.6 && r.height < 220 && r.top <= base + 24 && r.bottom > base) t = Math.max(t, r.bottom);
        });
        setTop(Math.round(t + 10));
        setShow(true);
        timer = setTimeout(() => setShow(false), 1600);
      });
    };
    main.addEventListener('scroll', on, { passive: true });
    return () => { main.removeEventListener('scroll', on); clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [resetKey]);

  const goTop = () => { setShow(false); mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <button
      type="button"
      onClick={goTop}
      aria-label="Voltar ao topo"
      data-testid="scroll-up"
      tabIndex={show ? 0 : -1}
      className="fixed z-[45] w-11 h-11 rounded-full flex items-center justify-center text-zinc-200 border border-white/10 active:scale-95"
      style={{ right: 14, top, background: 'rgba(16,16,19,.55)', opacity: show ? 1 : 0, transform: show ? 'none' : 'translateY(-6px)', pointerEvents: show ? 'auto' : 'none', transition: 'opacity .2s, transform .2s' }}
    >
      <ChevronUp className="w-6 h-6" strokeWidth={1.5} />
    </button>
  );
}
