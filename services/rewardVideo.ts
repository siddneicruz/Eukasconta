// Vídeo com recompensa (AdMob): depois dos 5 leituras grátis do dia, cada vídeo assistido libera 1 leitura.
// O crédito NÃO é dado pelo app: o Google avisa o servidor (função admob-ssv), que confere a assinatura e paga.
// Aqui o app só mostra o consentimento, toca o vídeo e espera o saldo subir.
import { AdMob, RewardAdPluginEvents, AdmobConsentStatus } from '@capacitor-community/admob';
import { supabase } from './supabaseClient';
import { isNativeApp } from './platform';

// IDs de TESTE do Google. Quando o app for publicado e vinculado ao AdMob, troque pelo ID real da unidade
// (variável VITE_ADMOB_REWARD_UNIT, e o ID do app no AndroidManifest).
const TEST_REWARD_UNIT = 'ca-app-pub-3940256099942544/5224354917';
const env = import.meta.env as Record<string, string | undefined>;
const REWARD_UNIT = env.VITE_ADMOB_REWARD_UNIT || TEST_REWARD_UNIT;
const IS_TESTING = REWARD_UNIT === TEST_REWARD_UNIT;

export interface ReadStatus { admin: boolean; balance: number; free_left: number; free_cap: number; videos_today: number }

export const fetchReadStatus = async (): Promise<ReadStatus | null> => {
  try {
    const { data, error } = await supabase.rpc('my_read_status', {});
    if (error || !data) return null;
    return data as ReadStatus;
  } catch { return null; }
};

let started = false;
const start = async (): Promise<{ ok: boolean; message?: string }> => {
  if (!isNativeApp()) return { ok: false, message: 'O vídeo só funciona no app instalado no celular.' };
  try {
    // Consentimento (LGPD/UMP): sem aceitar, não toca anúncio.
    let info = await AdMob.requestConsentInfo();
    if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) info = await AdMob.showConsentForm();
    if (info.status === AdmobConsentStatus.REQUIRED) return { ok: false, message: 'Para assistir ao vídeo é preciso responder à tela de consentimento.' };
    if (!started) { await AdMob.initialize({ initializeForTesting: IS_TESTING }); started = true; }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, message: 'Não foi possível preparar o anúncio agora. Tente de novo em instantes.' };
  }
};

export type WatchResult = { ok: true; credited: boolean } | { ok: false; message: string };

// Toca o vídeo e, se o espectador ganhou a recompensa, espera até ~20 s o servidor creditar (o aviso do Google chega depois do vídeo).
export const watchRewardVideo = async (onStep?: (s: string) => void): Promise<WatchResult> => {
  const prep = await start();
  if (!prep.ok) return { ok: false, message: prep.message || 'Anúncio indisponível.' };

  const { data: sess } = await supabase.auth.getSession();
  const userId = sess?.session?.user?.id;
  if (!userId) return { ok: false, message: 'Entre na sua conta para assistir ao vídeo.' };

  const before = (await fetchReadStatus())?.balance ?? 0;
  let rewarded = false;
  const handles: { remove: () => Promise<void> }[] = [];
  try {
    handles.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { rewarded = true; }));
    onStep?.('Carregando o vídeo...');
    await AdMob.prepareRewardVideoAd({ adId: REWARD_UNIT, isTesting: IS_TESTING, ssv: { userId } });
    onStep?.('Tocando o vídeo...');
    await AdMob.showRewardVideoAd();
  } catch (e: any) {
    return { ok: false, message: 'Nenhum vídeo disponível agora. Tente de novo daqui a pouco.' };
  } finally {
    for (const h of handles) { try { await h.remove(); } catch { /* ignora */ } }
  }
  if (!rewarded) return { ok: false, message: 'O vídeo foi fechado antes do fim, então a leitura não foi liberada.' };

  onStep?.('Liberando a leitura...');
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const s = await fetchReadStatus();
    if (s && s.balance > before) return { ok: true, credited: true };
  }
  return { ok: true, credited: false };
};
