import React from 'react';

/* Esqueletos de carregamento: blocos cinza com um brilho leve, no lugar de spinner/texto "carregando".
   No modo leve (aparelho fraco) o brilho some e fica só o bloco parado. */
export const SkeletonBar = ({ className = '' }: { className?: string }) => <div className={`ek-skel rounded-lg ${className}`} />;

export const SkeletonRows = ({ rows = 4, className = '' }: { rows?: number; className?: string }) => (
  <div className={`space-y-3 ${className}`} aria-busy="true" aria-label="Carregando">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3">
        <SkeletonBar className="w-9 h-9 rounded-xl shrink-0" />
        <div className="flex-1 space-y-2"><SkeletonBar className="h-3 w-3/5" /><SkeletonBar className="h-2.5 w-2/5" /></div>
        <SkeletonBar className="h-4 w-14" />
      </div>
    ))}
  </div>
);

export const SkeletonPage = () => (
  <div className="space-y-5 py-2" aria-busy="true" aria-label="Carregando">
    <SkeletonBar className="h-7 w-2/5" />
    <SkeletonBar className="h-28 w-full rounded-2xl" />
    <SkeletonRows rows={5} />
  </div>
);
