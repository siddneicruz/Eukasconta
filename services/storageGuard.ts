// O localStorage do WebView tem cota (~5 milhões de caracteres). Estourar a cota lançava erro
// dentro de efeitos do React e derrubava a tela inteira. Aqui o erro é capturado, o app segue
// funcionando e a interface é avisada para mostrar um aviso claro.
export const STORAGE_FULL_EVENT = 'eukasconta:storage-full';

let installed = false;

export const installStorageGuard = () => {
  if (installed || typeof Storage === 'undefined') return;
  installed = true;
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key: string, value: string) {
    try {
      original.call(this, key, value);
    } catch (e: any) {
      const quota = e?.name === 'QuotaExceededError' || e?.code === 22 || e?.code === 1014 || /quota/i.test(String(e?.message));
      if (!quota) throw e;
      try { window.dispatchEvent(new CustomEvent(STORAGE_FULL_EVENT, { detail: { key, size: String(value).length } })); } catch { /* ok */ }
    }
  };
};
