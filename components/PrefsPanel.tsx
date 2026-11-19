import React from 'react';
import { useMasterInfo } from './MasterContext';
import { useMotionPref, setMotion, useViewAsUser, setViewAsUser } from '../services/uiPrefs';

/* Preferências de uso deste aparelho: o movimento da rolagem é escolha de cada pessoa; o administrador também escolhe como quer ver o app. */

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; testId: string }> = ({ on, onChange, label, testId }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} data-testid={testId} onClick={() => onChange(!on)}
    className={`shrink-0 w-12 h-7 rounded-full border transition-colors relative ${on ? 'bg-luxury-gold/80 border-luxury-gold' : 'bg-white/5 border-white/15'}`}>
    <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
  </button>
);

const Row: React.FC<{ title: string; desc: string; children: React.ReactNode }> = ({ title, desc, children }) => (
  <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/10">
    <div className="min-w-0">
      <p className="text-sm font-bold text-zinc-100">{title}</p>
      <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{desc}</p>
    </div>
    {children}
  </div>
);

const PrefsPanel: React.FC = () => {
  const master = useMasterInfo();
  const motion = useMotionPref();
  const asUser = useViewAsUser();
  return (
    <section className="space-y-3" data-testid="prefs-panel">
      <h3 className="ml-1 text-[11px] font-bold tracking-[0.14em] text-zinc-500 uppercase">Preferências</h3>
      <Row title="Movimento ao rolar" desc="Piscada dourada nos cards, vibração leve e empurrão que para no próximo card. Desligado, a rolagem fica comum.">
        <Switch on={motion} onChange={setMotion} label="Movimento ao rolar" testId="pref-motion" />
      </Row>
      {master.isRealAdmin && (
        <Row title="Ver como usuário comum" desc={asUser ? 'Você está vendo o app como um usuário comum. Desligue para voltar às telas de administrador.' : 'Ligue para testar o app do jeito que um usuário comum vê, sem as telas de administrador.'}>
          <Switch on={asUser} onChange={setViewAsUser} label="Ver como usuário comum" testId="pref-view-as-user" />
        </Row>
      )}
    </section>
  );
};

export default PrefsPanel;
