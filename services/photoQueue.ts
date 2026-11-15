/* Fila de fotos de produto ainda não lidas pela IA (sem internet, IA fora do ar). Fica no aparelho até a leitura dar certo ou a pessoa descartar. */
export interface QueuedPhoto { b64: string; mime: string }
export interface QueuedProduct { id: string; photos: QueuedPhoto[]; barcode: string; at: number; error?: string }

const DB = 'eukasconta_photo_queue', STORE = 'items';
const open = (): Promise<IDBDatabase> => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise<T>((res, rej) => { const q = fn(db.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
};

export const queueList = async (): Promise<QueuedProduct[]> => { try { return ((await tx('readonly', s => s.getAll())) as QueuedProduct[]).sort((a, b) => b.at - a.at); } catch { return []; } };
export const queueSave = async (q: QueuedProduct): Promise<void> => { try { await tx('readwrite', s => s.put(q)); } catch { /* sem armazenamento: segue sem guardar */ } };
export const queueRemove = async (id: string): Promise<void> => { try { await tx('readwrite', s => s.delete(id)); } catch { /* nada a remover */ } };
