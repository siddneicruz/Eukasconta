// Os dados do app neste aparelho: tudo mora no localStorage, em chaves que começam com "eukasconta_".
// Aqui ficam as regras de quais chaves contam como "dados" (o que o backup na conta e os pontos de restauração copiam),
// e como ler e gravar esse conjunto. Sem nuvem: quem precisa só disto (pontos de restauração, testes) não puxa o Supabase.

export const PREFIX = 'eukasconta_';

// Chaves de IA e escolhas ligadas a elas: vão na coluna "secrets" do backup, só se a pessoa deixar.
export const SECRET_PREFIXES = ['eukasconta_byok_', 'eukasconta_active_ai_provider', 'eukasconta_openrouter_model_'];

// Ficam só neste aparelho: controle da própria nuvem, diagnóstico, simulador, os pontos de restauração antigos e os
// controles dos novos (cada ponto é uma cópia inteira dos dados e multiplicaria o tamanho do backup) e o mapa salvo.
export const DEVICE_ONLY = [
  /^eukasconta_cloud_/,
  /^eukasconta_backup_/,
  /^eukasconta_diagnostics$/,
  /^eukasconta_emulator_prefs$/,
  /^eukasconta_snapshots$/,
  /^eukasconta_restore_/,
  /^eukasconta_maps_/,
];

export interface LocalSnapshot {
  data: Record<string, string>;
  secrets: Record<string, string>;
  receiptCount: number;
}

export const isSecretKey = (k: string) => SECRET_PREFIXES.some(p => k === p || k.startsWith(p));
export const isDeviceOnly = (k: string) => DEVICE_ONLY.some(r => r.test(k));
/** Chave que entra num backup ou ponto de restauração (dado do app, não segredo nem controle do aparelho). */
export const isDataKey = (k: string) => k.startsWith(PREFIX) && !isSecretKey(k) && !isDeviceOnly(k);

export const safeGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };

export const localReceiptCount = (): number => {
  const raw = safeGet('eukasconta_data');
  if (!raw) return 0;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.length : 0; } catch { return 0; }
};

export const collectLocal = (): LocalSnapshot => {
  const data: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const v = localStorage.getItem(k);
      if (v === null) continue;
      if (isSecretKey(k)) { if (v.trim()) secrets[k] = v; continue; }
      if (isDeviceOnly(k)) continue;
      data[k] = v;
    }
  } catch { /* sem acesso ao armazenamento: devolve o que deu */ }
  return { data, secrets, receiptCount: localReceiptCount() };
};

// Impressão digital barata para saber se algo mudou desde o último envio.
export const fingerprint = (snap: { data: Record<string, string>; secrets: Record<string, string> }): string => {
  let h = 5381, n = 0;
  const feed = (s: string) => { for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; n += s.length; };
  [snap.data, snap.secrets].forEach(obj => Object.keys(obj).sort().forEach(k => { feed(k); feed('='); feed(obj[k]); feed(';'); }));
  return `${n}:${h >>> 0}`;
};

// Grava os dados do backup neste aparelho (a tela precisa recarregar depois para lê-los).
export const applyData = (data: Record<string, string>): number => {
  let n = 0;
  Object.entries(data).forEach(([k, v]) => {
    if (!isDataKey(k)) return;
    try { localStorage.setItem(k, v); n++; } catch { /* sem espaço: segue com o resto */ }
  });
  return n;
};

export interface ReplaceResult { ok: boolean; written: number; removed: number; error?: string }

/**
 * Troca os dados do aparelho pelos de `data`: o que não está em `data` é apagado, o que está é gravado e conferido.
 * Se algo não couber (ou falhar), devolve tudo como estava e diz o erro. Chaves de IA e controles do aparelho ficam como estão.
 * `overlay` só grava o que veio e não apaga o resto (para pontos antigos, que não guardavam tudo).
 */
export const replaceData = (data: Record<string, string>, overlay = false): ReplaceResult => {
  const incoming = Object.entries(data).filter(([k, v]) => isDataKey(k) && typeof v === 'string');
  const incomingKeys = new Set(incoming.map(([k]) => k));
  const drop: string[] = [];
  if (!overlay) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && isDataKey(k) && !incomingKeys.has(k)) drop.push(k);
      }
    } catch { return { ok: false, written: 0, removed: 0, error: 'Sem acesso ao armazenamento do aparelho.' }; }
  }
  const touched = [...drop, ...incomingKeys];
  const before = new Map<string, string | null>();
  try { touched.forEach(k => before.set(k, localStorage.getItem(k))); } catch { return { ok: false, written: 0, removed: 0, error: 'Sem acesso ao armazenamento do aparelho.' }; }
  const rollback = () => {
    before.forEach((v, k) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* melhor esforço */ } });
  };
  try {
    drop.forEach(k => localStorage.removeItem(k));
    for (const [k, v] of incoming) {
      localStorage.setItem(k, v);
      // o app engole o erro de "memória cheia" (storageGuard), então confere se gravou mesmo
      if (localStorage.getItem(k) !== v) throw new Error('Não coube no armazenamento do aparelho.');
    }
  } catch (e: any) {
    rollback();
    return { ok: false, written: 0, removed: 0, error: String(e?.message || e) };
  }
  return { ok: true, written: incoming.length, removed: drop.length };
};

// Traz as chaves de IA do backup só para os provedores que este aparelho ainda não tem;
// nunca troca uma chave que a pessoa já colou aqui. Devolve quantas entraram.
export const applySecretsIfMissing = (secrets: Record<string, string>): number => {
  let n = 0;
  Object.entries(secrets).forEach(([k, v]) => {
    if (!k.startsWith(PREFIX) || !isSecretKey(k) || !v.trim()) return;
    if (safeGet(k)) return;
    try { localStorage.setItem(k, v); n++; } catch { /* ignora */ }
  });
  return n;
};
