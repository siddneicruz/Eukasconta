// Leitura de cupons e tarefas de IA pelo servidor.
// A chave do OpenRouter fica só aqui (secret OPENROUTER_API_KEY); o app envia a conta logada.
// Cada chamada grava tokens e custo em usage_events (srv_read_begin / srv_read_end).
// Variáveis: OPENROUTER_API_KEY (obrigatória), CHARGE_READS=1 liga o desconto de crédito, DAILY_CAP (padrão 30).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MODEL = 'anthropic/claude-haiku-5.5';
const MAX_BODY = 9_000_000;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });

  const orKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!orKey) return json(503, { error: 'Leitura por servidor ainda não configurada.', reason: 'sem_chave' });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data: u } = await admin.auth.getUser(token);
  const userId = u?.user?.id;
  if (!userId) return json(401, { error: 'Entre na sua conta para ler cupons.', reason: 'sem_login' });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: 'Imagem grande demais.', reason: 'grande' });
  let b: any;
  try { b = JSON.parse(raw); } catch { return json(400, { error: 'Pedido inválido.' }); }
  if (!Array.isArray(b?.messages) || b.messages.length === 0) return json(400, { error: 'Pedido sem mensagens.' });

  const charge = Deno.env.get('CHARGE_READS') === '1';
  const cap = Number(Deno.env.get('DAILY_CAP')) || 30;
  const kind = b.kind === 'texto' ? 'leitura_texto' : b.kind === 'foto' ? 'leitura_foto' : 'leitura_cupom';
  const ref = typeof b.ref === 'string' ? b.ref : null;

  const { data: gate, error: gErr } = await admin.rpc('srv_read_begin', { p_user: userId, p_daily_cap: cap, p_charge: charge });
  if (gErr) return json(500, { error: 'Falha ao conferir o limite de leituras.' });
  if (!gate?.allowed) {
    const msg = gate.reason === 'limite_diario' ? 'Você atingiu o limite de leituras de hoje. Volte amanhã.'
      : gate.reason === 'sem_credito' ? 'Sem créditos de leitura. Assista a um vídeo para liberar.'
      : 'Leitura não liberada para esta conta.';
    return json(gate.reason === 'sem_credito' ? 402 : 429, { error: msg, reason: gate.reason });
  }

  const started = Date.now();
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: b.messages,
    temperature: 0.1,
    max_tokens: Math.min(Number(b.max_tokens) || 8000, 20000),
    usage: { include: true },
  };
  if (b.response_format?.type === 'json_object') body.response_format = { type: 'json_object' };

  const finish = (ok: boolean, d: any) =>
    admin.rpc('srv_read_end', {
      p_user: userId, p_kind: kind, p_model: d?.model || MODEL,
      p_tokens_in: d?.usage?.prompt_tokens ?? null, p_tokens_out: d?.usage?.completion_tokens ?? null,
      p_cost: d?.usage?.cost ?? null, p_ok: ok, p_ms: Date.now() - started, p_ref: ref, p_charge: charge,
    });

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(130_000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${orKey}`,
        'HTTP-Referer': 'https://eukasconta.app',
        'X-Title': 'Eukasconta',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    const ok = res.ok && !data?.error && typeof text === 'string' && text.trim().length > 0;
    await finish(ok, data);
    if (!ok) return json(res.ok ? 502 : res.status, { error: data?.error?.message || 'A IA não devolveu resposta.', reason: 'ia' });
    return json(200, data);
  } catch (e) {
    await finish(false, null);
    return json(504, { error: 'A leitura demorou demais. Tente de novo.', reason: 'tempo' });
  }
});
