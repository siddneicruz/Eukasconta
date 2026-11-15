import React, { useEffect, useRef, useState } from 'react';

/** Só monta o conteúdo quando ele chega perto da tela: o Início abre sem esperar por buscas na nuvem de cartões lá embaixo. */
const LazyMount: React.FC<{ children: React.ReactNode; minHeight?: number }> = ({ children, minHeight = 200 }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setOn(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} style={on ? undefined : { minHeight }}>{on ? children : null}</div>;
};

export default LazyMount;
