import React from 'react';

// Chave liga/desliga (a mesma da tela da conta e dos pontos de restauração).
const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; testId?: string }> = ({ on, onChange, label, disabled, testId }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    data-testid={testId}
    onClick={() => onChange(!on)}
    className={`relative w-12 h-7 rounded-full border transition-all shrink-0 disabled:opacity-40 ${on ? 'bg-luxury-gold border-luxury-gold' : 'bg-white/5 border-white/15'}`}
  >
    <span className={`absolute top-0.5 w-5 h-5 rounded-full transition-all ${on ? 'left-6 bg-black' : 'left-0.5 bg-zinc-400'}`} />
  </button>
);

export default Switch;
