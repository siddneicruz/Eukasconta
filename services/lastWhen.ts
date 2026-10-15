import { useEffect, useState } from 'react';

/* Textos de "quando foi": "hoje às 12:27", "ontem às 18:03", "12/10 às 18:03" e "há 2 min".
   Usado para dizer sempre quando foi o último backup. */

const pad = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export const parseWhen = (iso?: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

/** "hoje às 12:27" · "ontem às 18:03" · "12/10 às 18:03" · "12/10/2025 às 18:03" */
export const whenText = (d: Date, now: Date = new Date()): string => {
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return `hoje às ${time}`;
  if (diffDays === 1) return `ontem às ${time}`;
  const dm = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  return d.getFullYear() === now.getFullYear() ? `${dm} às ${time}` : `${dm}/${d.getFullYear()} às ${time}`;
};

/** "agora mesmo" · "há 5 min" · "há 3 h" · "há 4 dias" · "há 2 meses" */
export const agoText = (d: Date, now: Date = new Date()): string => {
  const sec = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (sec < 45) return 'agora mesmo';
  const min = Math.round(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 60) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
  const months = Math.floor(days / 30);
  return `há ${months} meses`;
};

/** "hoje às 12:27 · há 5 min" (vazio se a data não vale). */
export const lastWhenText = (iso?: string | null, now: Date = new Date()): string => {
  const d = parseWhen(iso);
  return d ? `${whenText(d, now)} · ${agoText(d, now)}` : '';
};

/** A hora de agora, atualizada de tempos em tempos (para o "há X min" não ficar parado). */
export const useNow = (everyMs = 30_000): Date => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
};

/* Último backup em arquivo (Exportar): fica só neste aparelho (a chave começa com eukasconta_backup_). */
export const FILE_BACKUP_KEY = 'eukasconta_backup_file_at';
export const FILE_BACKUP_EVENT = 'eukasconta:file-backup';

export const readFileBackupAt = (): string | null => {
  try { return localStorage.getItem(FILE_BACKUP_KEY); } catch { return null; }
};

export const markFileBackup = (at: Date = new Date()): void => {
  try { localStorage.setItem(FILE_BACKUP_KEY, at.toISOString()); } catch { /* ignora */ }
  try { window.dispatchEvent(new Event(FILE_BACKUP_EVENT)); } catch { /* ignora */ }
};

export const useFileBackupAt = (): string | null => {
  const [at, setAt] = useState<string | null>(() => readFileBackupAt());
  useEffect(() => {
    const on = () => setAt(readFileBackupAt());
    window.addEventListener(FILE_BACKUP_EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(FILE_BACKUP_EVENT, on); window.removeEventListener('storage', on); };
  }, []);
  return at;
};
