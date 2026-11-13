import { Share } from '@capacitor/share';
import { isNativeApp } from './platform';
import type { Receipt } from '../types';

/** Abre a folha de compartilhar com um texto pronto (no Android a pessoa escolhe o WhatsApp). 'cancelled' se fechar sem enviar. */
export const shareText = async (text: string, title = 'Eu Kasconta'): Promise<'sent' | 'cancelled'> => {
  try {
    if (isNativeApp()) {
      await Share.share({ title, text, dialogTitle: 'Enviar por WhatsApp ou outro app' });
      return 'sent';
    }
    if (typeof navigator !== 'undefined' && (navigator as any).share) { await (navigator as any).share({ title, text }); return 'sent'; }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    return 'sent';
  } catch (e: any) {
    if (/cancel|abort/i.test(String(e?.name || '') + String(e?.message || ''))) return 'cancelled';
    throw e;
  }
};

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const num = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const br = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
const qtyTxt = (q: number) => String(Math.round(q * 1000) / 1000).replace('.', ',');

/** Cupom em texto para o WhatsApp (negrito com *…*). */
export const receiptToWhatsApp = (r: Receipt): string => {
  const lines: string[] = [`*${r.establishmentName}*`, `${br(r.date)}${r.time ? ` às ${r.time}` : ''}`, ''];
  (r.items || []).forEach(i => {
    const q = Number(i.quantity) || 1;
    const u = String(i.unitType || 'un').toLowerCase();
    lines.push(`• ${i.description} — ${qtyTxt(q)} ${u} × ${num(Number(i.unitPrice) || 0)} = ${num(Number(i.totalPrice) || 0)}`);
  });
  lines.push('', `*Total ${brl(Number(r.totalAmount) || 0)}*`);
  return lines.join('\n');
};

export interface ShareSection { title: string; items: { name: string; qty: string; price: number; cost: number; cart: boolean }[] }

/** Lista de compras em texto: ⬜ para comprar, ✅ já no carrinho (o WhatsApp não tem caixinha de marcar, então vai o emoji). */
export const shoppingListToWhatsApp = (name: string, groups: { label: string; total: number; sections: ShareSection[] }[], total: number): string => {
  const out: string[] = [`🛒 *${name}*`];
  if (total > 0) out.push(`Total estimado: *${brl(total)}*`);
  groups.forEach(g => {
    out.push('', `*${g.label}*${g.total > 0 ? ` · ${brl(g.total)}` : ''}`);
    g.sections.forEach(s => {
      out.push(`_${s.title}_`);
      s.items.forEach(it => out.push(`${it.cart ? '✅' : '⬜'} ${it.name} — ${it.qty}${it.price > 0 ? ` · ${brl(it.cost)}` : ''}`));
    });
  });
  return out.join('\n');
};
