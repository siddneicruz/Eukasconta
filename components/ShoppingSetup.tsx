import React, { useMemo, useState } from 'react';
import { Minus, Plus, Sparkles, Wallet, CalendarDays, Apple, Beef, Loader2, AlertTriangle, ChevronLeft, ChevronRight, ShoppingCart } from 'lucide-react';
import {
  Setup, History, Mode, MonthPreset, MONTHS, WEEKDAYS, WEEKDAYS_SHORT, daysInMonth, presetMonthDays, purchasesFromSetup, weekdayOf, shortDate,
} from '../services/shoppingList';
import { brl, parseMoney, moneyText } from './ShoppingSheets';

/* Formulário da lista: quando vai ao mercado, quanto quer gastar, o que mais entra (frutas e verduras, churrasco) e se a IA ajuda. */

interface Props {
  initial: Setup;
  today: string;
  history: History;
  aiLabel: string;
  hasKey: boolean;
  busy: string | null;
  error: string | null;
  editing: boolean;
  onSubmit: (s: Setup) => void;
  onCancel: () => void;
}

const Card: React.FC<{ icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode; testId?: string }> = ({ icon, title, sub, children, testId }) => (
  <section className="bg-[#121214] border border-white/5 rounded-2xl p-4 shadow-xl" data-testid={testId}>
    <div className="flex items-start gap-2.5 mb-3">
      <span className="mt-0.5 text-luxury-gold shrink-0">{icon}</span>
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-zinc-100 leading-tight">{title}</h3>
        {sub && <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{sub}</p>}
      </div>
    </div>
    {children}
  </section>
);

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; testId: string; disabled?: boolean }> = ({ on, onChange, label, testId, disabled }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} data-testid={testId} disabled={disabled} onClick={() => onChange(!on)}
    className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${on ? 'bg-luxury-gold' : 'bg-zinc-600'} ${disabled ? 'opacity-40' : ''}`}>
    <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
  </button>
);

const Stepper: React.FC<{ value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label: string; testId: string; suffix?: string }> = ({ value, onChange, min, max, step = 1, label, testId, suffix = '' }) => (
  <div className="inline-flex items-center rounded-xl bg-white/5 border border-white/10">
    <button type="button" aria-label={`Diminuir ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}
      className="w-11 h-11 flex items-center justify-center text-zinc-300 active:text-luxury-gold disabled:opacity-30"><Minus className="w-4 h-4" /></button>
    <span data-testid={testId} className="min-w-[3.75rem] text-center text-[15px] font-semibold tabular-nums text-white">{value}{suffix}</span>
    <button type="button" aria-label={`Aumentar ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}
      className="w-11 h-11 flex items-center justify-center text-zinc-300 active:text-luxury-gold disabled:opacity-30"><Plus className="w-4 h-4" /></button>
  </div>
);

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; testId?: string; label?: string; disabled?: boolean }> = ({ on, onClick, children, testId, label, disabled }) => (
  <button type="button" onClick={onClick} data-testid={testId} aria-pressed={on} aria-label={label} disabled={disabled}
    className={`min-h-[40px] px-3 rounded-xl border text-[13px] font-semibold tabular-nums transition-colors ${on ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/10 text-zinc-300 hover:border-luxury-gold/40'} ${disabled ? 'opacity-30' : ''}`}>
    {children}
  </button>
);

const ShoppingSetup: React.FC<Props> = ({ initial, today, history, aiLabel, hasKey, busy, error, editing, onSubmit, onCancel }) => {
  const [s, setS] = useState<Setup>(() => {
    const base: Setup = { ...initial, useAi: hasKey ? initial.useAi : false };
    if (base.mode === 'month' && !base.monthDays.length) base.monthDays = presetMonthDays('semanal', base.year, base.month, today);
    return base;
  });
  const [minTxt, setMinTxt] = useState(moneyText(initial.min));
  const [maxTxt, setMaxTxt] = useState(moneyText(initial.max));
  const patch = (p: Partial<Setup>) => setS(prev => ({ ...prev, ...p }));

  const purchases = useMemo(() => purchasesFromSetup(s, today), [s, today]);
  const horizon = purchases.reduce((sum, p) => sum + p.days, 0);
  const min = parseMoney(minTxt) || null;
  const max = parseMoney(maxTxt) || null;
  const budgetErr = min && max && min > max ? 'O mínimo não pode ser maior que o teto.' : null;
  const canSubmit = !busy && purchases.length > 0 && !budgetErr;

  // mês: de este mês até 3 meses à frente
  const nowYm = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  const ym = s.year * 12 + s.month - 1;
  const moveMonth = (delta: number) => {
    const next = Math.min(nowYm + 3, Math.max(nowYm, ym + delta));
    const year = Math.floor(next / 12);
    const month = (next % 12) + 1;
    patch({ year, month, monthDays: presetMonthDays('semanal', year, month, today) });
  };
  const isNowMonth = ym === nowYm;
  const minDay = isNowMonth ? Number(today.slice(8, 10)) : 1;
  const dim = daysInMonth(s.year, s.month);
  const lead = weekdayOf(`${s.year}-${String(s.month).padStart(2, '0')}-01`);
  const toggleDay = (d: number) => patch({ monthDays: s.monthDays.includes(d) ? s.monthDays.filter(x => x !== d) : [...s.monthDays, d].sort((a, b) => a - b) });
  const preset = (k: MonthPreset) => patch({ monthDays: presetMonthDays(k, s.year, s.month, today) });
  const sameDays = (k: MonthPreset) => { const p = presetMonthDays(k, s.year, s.month, today); return p.length === s.monthDays.length && p.every((d, i) => d === s.monthDays[i]); };

  const avgFor = Math.round(history.perDay * horizon);
  const modes: { id: Mode; label: string }[] = [{ id: 'single', label: 'Uma compra' }, { id: 'weekly', label: 'Por semana' }, { id: 'month', label: 'Mês' }];

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ ...s, min, max, useAi: hasKey && s.useAi });
  };

  return (
    <div className="space-y-3" data-testid="shop-setup">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} aria-label="Voltar" data-testid="shop-setup-back" className="w-10 h-10 -ml-2 flex items-center justify-center rounded-xl text-zinc-400 hover:text-luxury-gold"><ChevronLeft className="w-5 h-5" /></button>
        <div className="min-w-0">
          <h2 className="text-xl font-serif font-bold text-white leading-tight">{editing ? 'Ajustar a lista' : 'Nova lista de compras'}</h2>
          <p className="text-[11px] text-zinc-500 leading-snug">Os preços e as quantidades saem das suas últimas compras.</p>
        </div>
      </div>

      <Card icon={<CalendarDays className="w-4 h-4" />} title="Quando você vai às compras?" sub={history.empty ? undefined : `Você costuma ir ao mercado a cada ${history.cycle} dias.`} testId="shop-when">
        <div className="flex p-1 gap-1 bg-white/5 rounded-xl" role="tablist" aria-label="Tipo de lista">
          {modes.map(m => (
            <button key={m.id} type="button" role="tab" aria-selected={s.mode === m.id} data-testid={`shop-mode-${m.id}`}
              onClick={() => patch(m.id === 'month' && !s.monthDays.length ? { mode: m.id, monthDays: presetMonthDays('semanal', s.year, s.month, today) } : { mode: m.id })}
              className={`flex-1 h-10 rounded-lg text-[13px] font-semibold transition-colors ${s.mode === m.id ? 'bg-luxury-gold text-black' : 'text-zinc-400'}`}>{m.label}</button>
          ))}
        </div>

        {s.mode === 'single' && (
          <div className="mt-3">
            <p className="text-[12px] text-zinc-400 mb-2">Quantos dias esta compra precisa cobrir?</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Stepper value={s.days} onChange={v => patch({ days: v })} min={1} max={60} label="dias" testId="shop-days" suffix=" dias" />
              {[7, 15, 30].map(d => <Chip key={d} on={s.days === d} onClick={() => patch({ days: d })} testId={`shop-days-${d}`}>{d}</Chip>)}
            </div>
          </div>
        )}

        {s.mode === 'weekly' && (
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-[12px] text-zinc-400 mb-2">Dia da semana da compra</p>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS_SHORT.map((w, i) => (
                  <button key={w} type="button" onClick={() => patch({ weekday: i })} data-testid={`shop-weekday-${i}`} aria-pressed={s.weekday === i} aria-label={WEEKDAYS[i]}
                    className={`h-10 rounded-lg border text-[12px] font-semibold capitalize ${s.weekday === i ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/10 text-zinc-300'}`}>{w}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] text-zinc-400">Quantas semanas?</p>
              <Stepper value={s.weeks} onChange={v => patch({ weeks: v })} min={1} max={8} label="semanas" testId="shop-weeks" />
            </div>
          </div>
        )}

        {s.mode === 'month' && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => moveMonth(-1)} disabled={ym <= nowYm} aria-label="Mês anterior" data-testid="shop-month-prev" className="w-10 h-10 flex items-center justify-center rounded-xl text-zinc-400 disabled:opacity-30"><ChevronLeft className="w-5 h-5" /></button>
              <p className="text-[14px] font-semibold text-white capitalize" data-testid="shop-month-label">{MONTHS[s.month - 1]} de {s.year}</p>
              <button type="button" onClick={() => moveMonth(1)} disabled={ym >= nowYm + 3} aria-label="Próximo mês" data-testid="shop-month-next" className="w-10 h-10 flex items-center justify-center rounded-xl text-zinc-400 disabled:opacity-30"><ChevronRight className="w-5 h-5" /></button>
            </div>
            <p className="text-[12px] text-zinc-400 mb-2">Toque nos dias do mês em que você vai ao mercado.</p>
            <div className="flex gap-1.5 flex-wrap mb-2">
              <Chip on={sameDays('semanal')} onClick={() => preset('semanal')} testId="shop-preset-semanal">Toda semana</Chip>
              <Chip on={sameDays('quinzenal')} onClick={() => preset('quinzenal')} testId="shop-preset-quinzenal">A cada 15 dias</Chip>
              <Chip on={sameDays('mensal')} onClick={() => preset('mensal')} testId="shop-preset-mensal">Uma vez só</Chip>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center mb-1" aria-hidden="true">
              {WEEKDAYS_SHORT.map(w => <span key={w} className="text-[10px] text-zinc-600 uppercase">{w.slice(0, 1)}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1" data-testid="shop-month-grid">
              {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} />)}
              {Array.from({ length: dim }, (_, i) => i + 1).map(d => {
                const on = s.monthDays.includes(d);
                const off = d < minDay;
                return (
                  <button key={d} type="button" disabled={off} onClick={() => toggleDay(d)} data-testid={`shop-day-${d}`} aria-pressed={on} aria-label={`Dia ${d}`}
                    className={`h-10 rounded-lg border text-[13px] font-semibold tabular-nums ${on ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/10 text-zinc-300'} ${off ? 'opacity-25' : ''}`}>{d}</button>
                );
              })}
            </div>
          </div>
        )}

        <p className="mt-3 text-[12px] text-zinc-400 tabular-nums" data-testid="shop-summary">
          {purchases.length === 0
            ? 'Escolha ao menos um dia de compra.'
            : <>{purchases.length} {purchases.length === 1 ? 'compra' : 'compras'} · cobre {horizon} dias{purchases.length > 1 ? <> · {purchases.map(p => shortDate(p.date).slice(4)).join(', ')}</> : ''}</>}
        </p>
      </Card>

      <Card icon={<Wallet className="w-4 h-4" />} title="Quanto quer gastar?" sub="Opcional. A lista se ajusta aos preços das suas últimas compras." testId="shop-budget">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] text-zinc-500">Mínimo (R$)</span>
            <input data-testid="shop-min" inputMode="decimal" value={minTxt} onChange={e => setMinTxt(e.target.value)} placeholder="sem mínimo"
              className="mt-1 w-full h-12 rounded-xl bg-white/5 border border-white/10 px-3 text-[16px] text-white tabular-nums outline-none focus:border-luxury-gold/60 placeholder:text-zinc-500" />
          </label>
          <label className="block">
            <span className="text-[11px] text-zinc-500">Teto (R$)</span>
            <input data-testid="shop-max" inputMode="decimal" value={maxTxt} onChange={e => setMaxTxt(e.target.value)} placeholder="sem teto"
              className="mt-1 w-full h-12 rounded-xl bg-white/5 border border-white/10 px-3 text-[16px] text-white tabular-nums outline-none focus:border-luxury-gold/60 placeholder:text-zinc-500" />
          </label>
        </div>
        {budgetErr && <p className="text-[12px] text-rose-400 mt-2" role="alert" data-testid="shop-budget-error">{budgetErr}</p>}
        {!history.empty && avgFor > 0 && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-500 leading-snug tabular-nums" data-testid="shop-avg">Nas últimas {history.tripCount} idas você gastou em média {brl(history.avgTrip)} por ida (cerca de {brl(avgFor)} em {horizon} dias).</p>
            <button type="button" onClick={() => setMaxTxt(moneyText(avgFor))} data-testid="shop-use-avg" className="shrink-0 min-h-[36px] px-3 rounded-lg border border-white/10 text-[12px] font-semibold text-luxury-gold">Usar de teto</button>
          </div>
        )}
      </Card>

      <Card icon={<Apple className="w-4 h-4" />} title="Frutas e verduras da semana" sub="Uma cesta com o que você mais compra, trocando algumas a cada semana." testId="shop-fv">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-zinc-300">Sugerir a cesta semanal</span>
          <Toggle on={s.fruitVeg} onChange={v => patch({ fruitVeg: v })} label="Sugerir frutas e verduras" testId="shop-fruitveg" />
        </div>
        {s.fruitVeg && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div><p className="text-[11px] text-zinc-500 mb-1">Frutas por semana</p><Stepper value={s.fruits} onChange={v => patch({ fruits: v })} min={0} max={12} label="frutas" testId="shop-fruits" /></div>
            <div><p className="text-[11px] text-zinc-500 mb-1">Verduras e legumes</p><Stepper value={s.veggies} onChange={v => patch({ veggies: v })} min={0} max={12} label="verduras" testId="shop-veggies" /></div>
          </div>
        )}
      </Card>

      <Card icon={<Beef className="w-4 h-4" />} title="Churrasco semanal" sub="Programa a carne de um churrasco por semana, com as carnes que você já compra." testId="shop-ch">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-zinc-300">Incluir o churrasco</span>
          <Toggle on={s.churrasco} onChange={v => patch({ churrasco: v })} label="Incluir churrasco" testId="shop-churrasco" />
        </div>
        {s.churrasco && (
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-[11px] text-zinc-500 mb-1">Dia do churrasco</p>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS_SHORT.map((w, i) => (
                  <button key={w} type="button" onClick={() => patch({ churrascoWeekday: i })} data-testid={`shop-cweekday-${i}`} aria-pressed={s.churrascoWeekday === i} aria-label={`Churrasco ${WEEKDAYS[i]}`}
                    className={`h-10 rounded-lg border text-[12px] font-semibold capitalize ${s.churrascoWeekday === i ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/10 text-zinc-300'}`}>{w}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><p className="text-[11px] text-zinc-500 mb-1">Pessoas</p><Stepper value={s.people} onChange={v => patch({ people: v })} min={1} max={60} label="pessoas" testId="shop-people" /></div>
              <div><p className="text-[11px] text-zinc-500 mb-1">Carne por pessoa</p><Stepper value={s.grams} onChange={v => patch({ grams: v })} min={100} max={1000} step={50} label="gramas" testId="shop-grams" suffix=" g" /></div>
            </div>
            <p className="text-[11px] text-zinc-500 tabular-nums" data-testid="shop-ch-kg">≈ {((s.people * s.grams) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg de carne por churrasco.</p>
          </div>
        )}
      </Card>

      <Card icon={<Sparkles className="w-4 h-4" />} title={`IA: ${aiLabel}`} sub="Escolhe o período de compras que melhor representa a sua casa e ajusta as quantidades. Os preços vêm sempre dos seus cupons." testId="shop-ai-card">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-zinc-300">Usar a IA</span>
          <Toggle on={s.useAi && hasKey} onChange={v => patch({ useAi: v })} label="Usar a IA" testId="shop-ai" disabled={!hasKey} />
        </div>
        {!hasKey && <p className="text-[11px] text-amber-400 mt-2 leading-snug" data-testid="shop-ai-nokey">Nenhuma chave de IA salva: a lista usa só o histórico dos cupons. Cadastre a chave em Config &gt; Chave IA.</p>}
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 text-[12px] text-rose-300" role="alert" data-testid="shop-error"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span></div>
      )}
      {history.empty && (
        <p className="text-[12px] text-amber-400 leading-snug" data-testid="shop-empty-warning">Ainda não há cupons com itens: escaneie algumas compras para a lista ter o que usar.</p>
      )}

      <button type="button" onClick={submit} disabled={!canSubmit || history.empty} data-testid="shop-generate"
        className="w-full h-12 rounded-2xl bg-luxury-gold text-black text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-40 active:opacity-80">
        {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> <span data-testid="shop-busy">{busy}</span></> : <><ShoppingCart className="w-5 h-5" /> {editing ? 'Gerar de novo' : 'Gerar lista'}</>}
      </button>
    </div>
  );
};

export default ShoppingSetup;
