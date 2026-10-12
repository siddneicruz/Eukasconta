
const PRODUCT_DATABASE: Record<string, string[]> = {
    'PICANHA': ['picanha', 'picanha fatiada', 'picanha grill', 'picanha resfriada'],
    'ALCATRA': ['alcatra', 'miolo de alcatra', 'alcatra com maminha', 'alcatra fatiada'],
    'MAMINHA': ['maminha', 'maminha bovina'],
    'CONTRA-FILÉ': ['contra file', 'contra-file', 'chorizo', 'ancho', 'entrecot', 'file de contra'],
    'FILÉ MIGNON': ['file mignon', 'filet mignon', 'file mignon s/cordao'],
    'PATINHO': ['patinho', 'patinho bovino', 'patinho moido'],
    'ACÉM': ['acem', 'acem bovino', 'acem moido'],
    'CARNE MOÍDA': ['carne moida', 'moida de 1a', 'moida de 2a', 'moida bovina'],
    'GASOLINA': ['gasolina', 'gasol', 'aditivada', 'comum', 'v-power', 'grid'],
    'ETANOL': ['etanol', 'alcool', 'etanol comum', 'etanol aditivado'],
    'DIESEL': ['diesel', 's10', 's500'],
    'LEITE': ['leite', 'uht', 'integral', 'desnatado', 'semi', 'caixa de leite', 'laticinio'],
    'SABÃO': ['sabao', 'detergente', 'lava louca', 'limpador', 'sabao em po', 'omo', 'ariel', 'tixan'],
    'VASSOURA': ['vassoura', 'rodo', 'mop', 'escova', 'faxina'],
    'CERVEJA': ['cerveja', 'chope', 'pilsen', 'ipa', 'lata', 'garrafa'],
    'REFRIGERANTE': ['refrigerante', 'coca', 'fanta', 'sprite', 'guarana'],
    'BANANA': ['banana', 'caturra', 'nanica', 'prata', 'terra'],
    'MACA': ['maca', 'fuji', 'gala', 'argentina', 'nacional'],
    'CEBOLA': ['cebola', 'cebola roxa', 'cebola branca', 'cebola kg'],
    'ALHO': ['alho', 'alho roxo', 'alho descascado'],
    'TOMATE': ['tomate', 'tomate cereja', 'tomate italiano', 'tomate saladete'],
    'ALFACE': ['alface', 'alface americana', 'alface crespa', 'alface lisa', 'alface broto'],
    'BROCOLIS': ['brocolis', 'brocolis ninja', 'brocolis cabe', 'broc'],
    'BATATA': ['batata', 'batata inglesa', 'batata doce', 'batata asterix'],
    'MAMÃO': ['mamao', 'papaia', 'formosa', 'hawai'],
    'GOIABA': ['goiaba', 'goiaba vermelha', 'goiaba branca'],
    'ARROZ': ['arroz', 'arroz parboilizado', 'arroz integral', 'arroz branco'],
    'FEIJAO': ['feijao', 'feijão', 'feijao preto', 'feijao carioca'],
    'LENTILHA': ['lentilha', 'lentilha seca', 'lentilha em graos'],
    'OLEO': ['oleo', 'óleo', 'oleo de soja', 'oleo de milho'],
    'ACUCAR': ['acucar', 'açúcar', 'acucar cristal', 'acucar refinado'],
    'UVA': ['uva', 'uva kg', 'uva bandeja', 'uva itala', 'uva niagara', 'uva thompson fresca'],
    // CATEGORIAS DE FRUTAS SECAS
    'UVA PASSA': ['uva passa', 'passas pretas', 'passas brancas', 'uva-passa'],
    'TÂMARA': ['tamara', 'tamara com caroco', 'tamara seca', 'tamara medjool'],
    'AMEIXA SECA': ['ameixa seca', 'ameixa sem caroco', 'ameixa desidratada'],
    'DAMASCO': ['damasco', 'damasco seco', 'damasco turco']
};

const NOISE_PREFIXES = ['HORTI', 'PROD', 'MERC', 'ART', 'ITEM', 'CX', 'UN', 'FRUTI'];

const QUALIFIERS: Record<string, string[]> = {
    'GASOLINA': ['comum', 'aditivada', 'v-power', 'grid', 'premium'],
    'ETANOL': ['comum', 'aditivado'],
    'DIESEL': ['s10', 's500', 'comum'],
    'BANANA': ['caturra', 'prata', 'nanica', 'maca', 'terra'],
    'MACA': ['fuji', 'gala', 'argentina', 'verde'],
    'ALFACE': ['americana', 'crespa', 'lisa', 'roxa', 'broto'],
    'LEITE': ['integral', 'desnatado', 'semi', 'zero lactose'],
    'CERVEJA': ['lata', 'long neck', 'garrafa', '600ml'],
    'CEBOLA': ['roxa', 'branca', 'kg'],
    'TOMATE': ['cereja', 'italiano', 'saladete', 'debora', 'longa vida'],
    'MAMÃO': ['formosa', 'papaia', 'hawai'],
    'GOIABA': ['vermelha', 'branca'],
    'UVA PASSA': ['preta', 'branca', 'sem semente'],
    'TÂMARA': ['seca', 'fresca', 'medjool', 'sem caroco']
};

const removeAccents = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const normalizeProductName = (rawDescription: string): string => {
    if (!rawDescription) return 'ITEM DESCONHECIDO';
    
    let clean = removeAccents(rawDescription.toUpperCase())
        .replace(/[0-9.,]+(KG|G|ML|L|UN)?/g, '')
        .replace(/[0-9.,]+/g, '')
        .replace(/[-/]/g, ' ')
        .trim();
    
    let words = clean.split(' ').filter(w => w.length > 0);
    // Loop para remover múltiplos prefixos de ruído (ex: HORTI FRUTI GOIABA)
    while (words.length > 1 && NOISE_PREFIXES.includes(words[0])) {
        words.shift();
    }
    clean = words.join(' ');

    const allSearchTerms: { term: string, genericName: string }[] = [];
    Object.entries(PRODUCT_DATABASE).forEach(([genericName, terms]) => {
        terms.forEach(term => { allSearchTerms.push({ term: removeAccents(term).toUpperCase(), genericName }); });
    });
    
    allSearchTerms.sort((a, b) => b.term.length - a.term.length);
    for (const { term, genericName } of allSearchTerms) {
        const regex = new RegExp(`\\b${term}\\b`, 'i');
        if (regex.test(clean)) return genericName;
    }
    
    return words[0] || 'ITEM';
};

export const getProductClassification = (rawDescription: string, contextGenericName?: string): string => {
    if (!rawDescription) return 'ITEM DESCONHECIDO';
    const generic = contextGenericName || normalizeProductName(rawDescription);
    const cleanDesc = removeAccents(rawDescription.toUpperCase());
    if (QUALIFIERS[generic]) {
        for (const qualifier of QUALIFIERS[generic]) {
            if (cleanDesc.includes(removeAccents(qualifier).toUpperCase())) {
                return `${generic} ${qualifier.toUpperCase()}`;
            }
        }
    }
    return PRODUCT_DATABASE[generic] ? generic : generic.substring(0, 25);
};

const normalizeDateString = (dateStr: string): string => {
    if (!dateStr || typeof dateStr !== 'string') return new Date().toISOString().split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const brMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (brMatch) {
        let day = brMatch[1].padStart(2, '0');
        let month = brMatch[2].padStart(2, '0');
        let year = brMatch[3];
        if (year.length === 2) year = '20' + year;
        return `${year}-${month}-${day}`;
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return new Date().toISOString().split('T')[0];
};

export const cleanCNPJ = (cnpj: string) => (cnpj || '').replace(/\D/g, '');

export const formatCNPJ = (cnpj: string) => {
    const cleaned = cleanCNPJ(cnpj);
    if (cleaned.length !== 14) return cnpj;
    return cleaned.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
};

export const auditAndRepairReceipt = (receipt: any): any => {
    const repairedReceipt = { ...receipt };
    repairedReceipt.date = normalizeDateString(repairedReceipt.date);
    repairedReceipt.cnpj = cleanCNPJ(repairedReceipt.cnpj);
    const items = repairedReceipt.items || [];
    let receiptTotal = Number(repairedReceipt.totalAmount);
    if (isNaN(receiptTotal)) receiptTotal = 0;
    repairedReceipt.items = items.map((item: any) => {
        let q = Number(item.quantity);
        let u = Number(item.unitPrice);
        let t = Number(item.totalPrice);
        
        // Saneamento de categoria para evitar duplicidade "Folhagens" vs "Folhas"
        let cat = item.category || 'Outros';
        if (cat.toUpperCase().includes('VERDURAS E FOLHAGENS')) {
            cat = cat.toUpperCase().replace('VERDURAS E FOLHAGENS', 'Verduras e Folhas');
        } else if (cat.includes('Hortifruti - Verduras e Folhagens')) {
            cat = 'Hortifruti - Verduras e Folhas';
        }

        if (isNaN(q) || q <= 0) q = 1;
        if (isNaN(u)) u = 0;
        if (isNaN(t)) t = 0;
        if (t < 0.01 && u > 0.01) t = q * u;
        else if (u < 0.01 && t > 0.01) u = t / q;
        
        return { 
            ...item, 
            category: cat,
            quantity: q, 
            unitPrice: Number(u.toFixed(2)), 
            totalPrice: Number(t.toFixed(2)) 
        };
    });
    const finalItemsSum = repairedReceipt.items.reduce((sum: number, i: any) => sum + i.totalPrice, 0);
    if (isNaN(receiptTotal) || receiptTotal < 0.01) {
        repairedReceipt.totalAmount = Number(finalItemsSum.toFixed(2));
    } else {
        repairedReceipt.totalAmount = Number(receiptTotal.toFixed(2));
    }
    return repairedReceipt;
};
