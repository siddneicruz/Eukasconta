// Limpeza de nomes de produto para comparar (sem acento, sem códigos, medidas e palavras de enchimento).
// Fica num arquivo próprio para o cadastro de códigos e o cadastro mestre usarem sem um depender do outro.

export const cleanDescriptionForMatching = (desc: string): string => {
    if (!desc) return '';
    let clean = desc.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    
    // Remove leading codes (e.g. PRD0015 or raw barcodes)
    clean = clean.replace(/^(PRD\d+|PROD\d+|\d+)\b/g, '');
    
    // Replace punctuation with spaces
    clean = clean.replace(/[.,;:\-_/\\()&|]/g, ' ');
    
    // Remove trailing volume specs or common unit measures (e.g. 50GR, 100ML, 50, 510, 2L, 1LT, 40VOL)
    clean = clean.replace(/\b\d+\s*(GR|G|ML|L|LT|VOL|UNID|UN)\b/g, ' ');
    clean = clean.replace(/\b\d+\b/g, ' '); // isolated numbers
    
    // Remove noise words and variants
    const noise = [
        'C/A', 'C/G', 'S/G', 'C/GAS', 'S/GAS', 'C/GA', 'S/GA', 'SEC', 'PROMO', 'DESSOSSADA', 'DESSOSADA',
        'HIDR', 'HIDROP', 'HIDROPONICA', 'ESTUFA', 'ESTUEA', 'BROTO', 'DAGUA', 'UN', 'UNID', 'KG', 'K'
    ];
    noise.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'g');
        clean = clean.replace(regex, ' ');
    });
    
    return clean.replace(/\s+/g, ' ').trim();
};
