// Cupom em texto (.txt) no formato de cupom térmico, e exportação de vários cupons em um .zip.
import JSZip from 'jszip';
import { Receipt } from '../types';
import { formatCNPJ } from './productNormalization';

// A tabela de itens manda na largura do cupom: traços, cabeçalho, total e linhas centralizadas usam todos a
// mesma largura, e as colunas do cabeçalho caem exatamente sobre as colunas dos itens.
const MIN_WIDTH = 54;

export const generateReceiptText = (receipt: Receipt): string => {
    const tableRow = (idx: string, desc: string, qtdUn: string, unitPrice: string, total: string) =>
        `${idx} ${desc.padEnd(26, ' ')} ${qtdUn.padStart(9, ' ')} ${unitPrice.padStart(6, ' ')} ${total.padStart(6, ' ')}`;
    const rows = receipt.items.map((item, idx) => {
        const idxStr = (idx + 1).toString().padStart(3, '0');
        let desc = item.description.toUpperCase();
        if (desc.length > 25) desc = desc.substring(0, 25);
        return tableRow(idxStr, desc, `${item.quantity} ${item.unitType || 'UN'}`, item.unitPrice.toFixed(2), item.totalPrice.toFixed(2));
    });
    const lineWidth = Math.max(MIN_WIDTH, ...rows.map(r => r.length));
    const center = (text: string) => {
        const padding = Math.max(0, (lineWidth - text.length) / 2);
        return ' '.repeat(Math.floor(padding)) + text + ' '.repeat(Math.ceil(padding));
    };
    const line = '-'.repeat(lineWidth);
    const formattedDate = receipt.date.split('-').reverse().join('/');

    let output = [
        line,
        center(receipt.establishmentName.toUpperCase()),
        center(receipt.address ? receipt.address.toUpperCase() : 'ENDERECO NAO INFORMADO'),
        center(`${(receipt.city || '').toUpperCase()} - ${(receipt.state || '').toUpperCase()}`),
        center(`CNPJ: ${formatCNPJ(receipt.cnpj) || 'NAO INFORMADO'}`),
        '',
        center(`${formattedDate} ${receipt.time}`),
        center(`EXTRATO Nº: ${receipt.receiptNumber || '000000'}`),
        line,
        ''
    ].join('\n');

    output += tableRow('IT'.padEnd(3, ' '), 'DESCRIÇÃO', 'QTD UN', 'VL.UN', 'TOTAL') + '\n';
    rows.forEach(r => { output += r + '\n'; });
    output += '\n' + line + '\n';
    const totalLabel = "TOTAL R$";
    const totalValue = receipt.totalAmount.toFixed(2);
    const spaces = lineWidth - totalLabel.length - totalValue.length;
    output += `${totalLabel}${' '.repeat(spaces)}${totalValue}\n\n`;
    output += center("OBRIGADO PELA PREFERÊNCIA") + '\n';
    output += center("PROJETO DESIGN STUDIO - AI AUDIT") + '\n';
    output += center(receipt.id.split('-')[0]) + '\n';
    return output;
};

const slugOf = (name: string): string =>
  (name || '').split(' ')[0].toUpperCase().replace(/[^A-Z0-9]/g, '') || 'CUPOM';

// Nome do arquivo de um cupom dentro do .zip: data e hora primeiro, para a pasta ficar em ordem de compra.
// O começo do id desempata dois cupons da mesma loja no mesmo minuto.
export const receiptTxtFileName = (r: Receipt): string => {
  const time = String(r.time || '').replace(/[^0-9]/g, '').slice(0, 4);
  const id = String(r.id || '').split('-')[0].slice(0, 8);
  return `${r.date || 'sem-data'}${time ? '_' + time : ''}_${slugOf(r.establishmentName)}${id ? '_' + id : ''}.txt`;
};

/** Um .zip com um arquivo .txt para cada cupom (cada um é o mesmo texto da aba "Cupom TXT"). */
export const buildReceiptsTxtZip = async (receipts: Receipt[]): Promise<{ blob: Blob; count: number; skipped: number }> => {
  const Zip = (JSZip as any).default || JSZip;
  const zip = new Zip();
  const used = new Set<string>();
  let count = 0;
  let skipped = 0;
  const ordered = [...receipts].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  ordered.forEach(r => {
    let text: string;
    // Um cupom com dado faltando (importado de backup antigo, por exemplo) não pode derrubar o .zip inteiro.
    try { text = generateReceiptText(r); } catch { skipped++; return; }
    let name = receiptTxtFileName(r);
    for (let n = 2; used.has(name); n++) name = receiptTxtFileName(r).replace(/\.txt$/, `_${n}.txt`);
    used.add(name);
    zip.file(name, text);
    count++;
  });
  const blob: Blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, count, skipped };
};
