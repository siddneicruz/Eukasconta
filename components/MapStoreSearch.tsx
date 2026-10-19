import React, { useMemo, useRef, useState } from 'react';
import { Search, X, MapPin, MapPinOff, Store } from 'lucide-react';
import { Poi, POI_KINDS } from '../services/poiService';
import { SearchableStore, searchPois, searchStores } from '../services/mapSearch';
import { formatDistance } from '../services/routingService';

/* Busca de estabelecimento, logo abaixo do mapa. Mostra as lojas das compras que combinam com o que foi digitado
   (nome, apelido, cidade, endereço ou CNPJ) e, se o mapa já carregou, as lojas do OpenStreetMap. Tocar numa loja leva o mapa até
   ela; loja sem posição abre o cadastro para corrigir o endereço. */

interface Props {
  stores: SearchableStore[];
  /** lojas do OpenStreetMap que o mapa já carregou */
  pois: Poi[];
  selectedId: string | null;
  /** a loja das compras que a pessoa já tem neste lugar do mapa: não repete nos resultados */
  isMine: (p: Poi) => boolean;
  onPickStore: (id: string) => void;
  onPickPoi: (p: Poi) => void;
  /** abre o cadastro da loja (para dar posição a quem não tem); sem isso, essas lojas só aparecem */
  onEditStore?: (id: string) => void;
  showingPois: boolean;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const MapStoreSearch: React.FC<Props> = ({ stores, pois, selectedId, isMine, onPickStore, onPickPoi, onEditStore, showingPois }) => {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLElement>(null);
  const q = query.trim();

  const found = useMemo(() => searchStores(q, stores), [q, stores]);
  const located = found.filter(s => s.located);
  const unlocated = found.filter(s => !s.located);
  const nearby = useMemo(() => (q ? searchPois(q, pois.filter(p => !isMine(p))) : []), [q, pois, isMine]);
  const total = found.length + nearby.length;

  const done = () => { setQuery(''); input.current?.blur(); };
  const pickStore = (id: string) => { onPickStore(id); done(); };
  const pickPoi = (p: Poi) => { onPickPoi(p); done(); };
  const editStore = (id: string) => { onEditStore?.(id); done(); };

  const onEnter = () => {
    if (located[0]) pickStore(located[0].id);
    else if (nearby[0]) pickPoi(nearby[0]);
    else if (unlocated[0] && onEditStore) editStore(unlocated[0].id);
  };

  const row = 'w-full text-left rounded-2xl border px-4 py-3 min-h-[56px] flex items-center gap-3 transition-colors active:scale-[0.99]';

  return (
    <section ref={box} className="mt-4 scroll-mt-24" aria-label="Buscar estabelecimento" data-testid="map-search">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-luxury-gold pointer-events-none" aria-hidden="true" />
        <input
          ref={input} type="text" value={query} onChange={e => setQuery(e.target.value)}
          // sobe a busca para perto do topo: assim os resultados não ficam escondidos atrás do teclado e do menu de baixo
          onFocus={() => { setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } else if (e.key === 'Escape') done(); }}
          placeholder="Buscar estabelecimento" aria-label="Buscar estabelecimento"
          autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" inputMode="search"
          data-testid="map-search-input"
          className="w-full h-14 rounded-2xl border border-white/10 bg-white/[0.04] pl-12 pr-12 text-base text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-luxury-gold/60"
        />
        {query && (
          <button type="button" onClick={() => { setQuery(''); input.current?.focus(); }} aria-label="Limpar a busca" data-testid="map-search-clear"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-xl flex items-center justify-center text-zinc-400 active:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {q && (
        <div className="mt-2 space-y-2" data-testid="map-search-results" role="listbox" aria-label="Lojas encontradas">
          {total === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5" data-testid="map-search-empty">
              <p className="text-sm font-bold text-zinc-200">Nenhuma loja encontrada para “{q}”.</p>
              <p className="text-xs text-zinc-500 mt-1 leading-snug">
                {showingPois
                  ? 'Aproxime o mapa para carregar as lojas dessa região e busque de novo.'
                  : 'Para achar lojas que ainda não estão nas suas compras, ligue o botão de lojas no mapa e aproxime a região.'}
              </p>
            </div>
          )}

          {located.map(s => {
            const active = s.id === selectedId;
            return (
              <button key={s.id} type="button" role="option" aria-selected={active} onClick={() => pickStore(s.id)}
                data-testid="map-search-result" data-kind="store" data-id={s.id}
                className={`${row} ${active ? 'border-luxury-gold/40 bg-luxury-gold/10' : 'border-white/5 bg-white/[0.03] active:bg-white/10'}`}>
                <MapPin className={`w-4 h-4 shrink-0 ${active ? 'text-luxury-gold' : 'text-zinc-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">{s.name}</p>
                  <p className="text-[11px] text-zinc-500 truncate">
                    {[s.city, `${s.visits} ${s.visits === 1 ? 'compra' : 'compras'}`, s.spent > 0 ? brl(s.spent) : ''].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {s.km !== null && <p className="shrink-0 text-sm font-bold tabular-nums text-luxury-gold">{formatDistance(s.km)}</p>}
              </button>
            );
          })}

          {nearby.length > 0 && (
            <>
              {located.length > 0 && <p className="px-1 pt-1 text-[11px] text-zinc-500 font-bold">No mapa, ainda fora das suas lojas</p>}
              {nearby.map(p => (
                <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => pickPoi(p)}
                  data-testid="map-search-result" data-kind="poi" data-id={p.id}
                  className={`${row} border-white/5 bg-white/[0.03] active:bg-white/10`}>
                  <Store className="w-4 h-4 shrink-0 text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white truncate">{p.name}</p>
                    <p className="text-[11px] text-zinc-500 truncate">{[POI_KINDS[p.kind]?.label, p.address].filter(Boolean).join(' · ') || 'Loja do mapa'}</p>
                  </div>
                </button>
              ))}
            </>
          )}

          {unlocated.length > 0 && (
            <>
              <p className="px-1 pt-1 text-[11px] text-zinc-500 font-bold">Sem posição no mapa ainda</p>
              {unlocated.map(s => {
                const Tag: any = onEditStore ? 'button' : 'div';
                return (
                  <Tag key={s.id} {...(onEditStore ? { type: 'button', onClick: () => editStore(s.id), role: 'option', 'aria-selected': false } : {})}
                    data-testid="map-search-result" data-kind="unlocated" data-id={s.id}
                    className={`${row} border-white/5 bg-white/[0.02] ${onEditStore ? 'active:bg-white/10' : ''}`}>
                    <MapPinOff className="w-4 h-4 shrink-0 text-amber-500/80" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-zinc-200 truncate">{s.name}</p>
                      <p className="text-[11px] text-zinc-500 truncate">
                        {[s.city, `${s.visits} ${s.visits === 1 ? 'compra' : 'compras'}`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {onEditStore && <span className="shrink-0 text-[11px] font-bold text-luxury-gold">Dar posição</span>}
                  </Tag>
                );
              })}
            </>
          )}
        </div>
      )}
    </section>
  );
};

export default MapStoreSearch;
