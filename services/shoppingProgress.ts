/* Andamento da geração da lista de compras: as etapas, o que cada uma achou e um registro ao vivo,
   no mesmo espírito da leitura de cupons. Aqui ficam só as contas do painel (sem tela), para poder testar. */

export type StepId = 'cupons' | 'conexao' | 'analise' | 'periodo' | 'itens' | 'calculo' | 'separacao' | 'montagem';
export type StepStatus = 'wait' | 'run' | 'done' | 'skip' | 'fail';

export type ProgressEvent =
  | { kind: 'step'; step: StepId; status: StepStatus; detail?: string }
  | { kind: 'log'; text: string };

export type Emit = (e: ProgressEvent) => void;

export interface StepState {
  id: StepId;
  label: string;
  status: StepStatus;
  detail?: string;
  /** quando começou (ms) */
  since?: number;
  /** quanto levou (ms) */
  took?: number;
  /** etapa que depende da IA */
  ai: boolean;
}

export interface ProgressState {
  steps: StepState[];
  logs: { at: number; text: string }[];
  startedAt: number;
}

export interface ProgressOptions {
  ai: boolean;
  aiLabel: string;
  fruitVeg: boolean;
  churrasco: boolean;
}

export const initialProgress = (o: ProgressOptions, now: number = Date.now()): ProgressState => {
  const steps: StepState[] = [
    { id: 'cupons', label: 'Lendo seus cupons', status: 'wait', ai: false },
  ];
  if (o.ai) steps.push({ id: 'conexao', label: `Conectando à IA (${o.aiLabel})`, status: 'wait', ai: true });
  steps.push({ id: 'analise', label: 'Analisando suas compras', status: 'wait', ai: false });
  if (o.ai) {
    steps.push({ id: 'periodo', label: 'IA escolhendo o período', status: 'wait', ai: true });
    steps.push({ id: 'itens', label: 'IA revisando as quantidades', status: 'wait', ai: true });
  }
  steps.push({ id: 'calculo', label: 'Calculando o que comprar', status: 'wait', ai: false });
  const extras = [o.fruitVeg ? 'frutas e verduras' : '', o.churrasco ? 'churrasco' : ''].filter(Boolean);
  steps.push({ id: 'separacao', label: extras.length ? `Separando por compra, teto, ${extras.join(' e ')}` : 'Separando por compra e conferindo teto e mínimo', status: 'wait', ai: false });
  steps.push({ id: 'montagem', label: 'Montando a lista', status: 'wait', ai: false });
  return { steps, logs: [], startedAt: now };
};

const MAX_LOGS = 80;

export const applyEvent = (s: ProgressState, e: ProgressEvent, now: number = Date.now()): ProgressState => {
  if (e.kind === 'log') {
    const logs = [...s.logs, { at: now - s.startedAt, text: e.text }];
    return { ...s, logs: logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs };
  }
  const steps = s.steps.map(st => {
    if (st.id !== e.step) return st;
    if (e.status === 'run') return { ...st, status: 'run' as const, detail: e.detail ?? st.detail, since: now, took: undefined };
    const took = st.since != null ? now - st.since : st.took;
    return { ...st, status: e.status, detail: e.detail ?? st.detail, took };
  });
  return { ...s, steps };
};

/** 0 a 100: etapas encerradas valem 1, a que está rodando vale meia. */
export const percentOf = (s: ProgressState): number => {
  const total = s.steps.length;
  if (!total) return 0;
  const done = s.steps.filter(x => x.status === 'done' || x.status === 'skip' || x.status === 'fail').length;
  const running = s.steps.some(x => x.status === 'run') ? 0.5 : 0;
  return Math.min(100, Math.round(((done + running) / total) * 100));
};

/** A IA ainda tem trabalho pela frente (rodando ou esperando)? Então o botão "Seguir sem a IA" faz sentido. */
export const aiPending = (s: ProgressState): boolean =>
  s.steps.some(x => x.ai && (x.status === 'run' || x.status === 'wait'));

export const secs = (ms: number): string => `${Math.max(0, Math.round(ms / 1000))} s`;

/** "+12 s" do registro. */
export const stamp = (ms: number): string => `+${Math.max(0, Math.round(ms / 1000))}s`;
