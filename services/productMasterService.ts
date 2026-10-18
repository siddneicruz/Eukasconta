import { Receipt, MasterProduct } from '../types';
import { cleanDescriptionForMatching } from './descriptionClean';
import {
    cleanCode, leadingCode, codeKind, normStoreKey, codesOf, addStoreCode, addEan, toGtin14,
    buildCodeIndex, indexEan, indexStoreCode, identifyByCode, looseSimilarity, isBlockedCode, noEanKey, noStoreKey,
} from './productCodes';

export { cleanDescriptionForMatching };

// Hardcoded expert rules for initial seeding and high-precision unifications
const EXPERT_UNIFICATION_RULES: { pattern: RegExp; parentName: string; unitType: string; category: string }[] = [
    {
        pattern: /\bALCATRA\s+(DESS?OS?ADA|BOVINA|DESS?OS?S?ADA)\b/i,
        parentName: "ALCATRA DESOSSADA",
        unitType: "KG",
        category: "Açougue - Carne Bovina"
    },
    {
        pattern: /\bACAFRA(D|O)\b.*\b(KITANO|KITAND|TERRA)\b/i,
        parentName: "AÇAFRÃO KITANO TERRA",
        unitType: "UN",
        category: "Despensa - Mercearia Salgada"
    },
    {
        pattern: /\bAGUA\s+(DE\s+)?COCO\s+DUCO(CO)?\b/i,
        parentName: "ÁGUA DE COCO DUCOCO 1L",
        unitType: "UN",
        category: "Bebidas - Não Alcoólicas"
    },
    {
        pattern: /\bAGUA\s+MINERAL\s+VALLE\s+AZUL\s+C\/\s*G/i,
        parentName: "ÁGUA MINERAL VALLE AZUL COM GÁS",
        unitType: "UN",
        category: "Bebidas - Não Alcoólicas"
    },
    {
        pattern: /\bAGUA\s+MIN.*VALLE\s+AZUL\s+S\/\s*G/i,
        parentName: "ÁGUA MINERAL VALLE AZUL SEM GÁS",
        unitType: "UN",
        category: "Bebidas - Não Alcoólicas"
    },
    {
        pattern: /\bAGUA\s+MINERAL\s+AGUA\s+DA?\b/i,
        parentName: "ÁGUA MINERAL ÁGUA DA PEDRA",
        unitType: "UN",
        category: "Bebidas - Não Alcoólicas"
    },
    {
        pattern: /\bALCOOL\s+LI(Q|D)\s+46\b/i,
        parentName: "ÁLCOOL LÍQUIDO 46º",
        unitType: "UN",
        category: "Limpeza - Cozinha e Banheiro"
    },
    {
        pattern: /\bALFACE\s+ESTU(F|E)A\b/i,
        parentName: "ALFACE ESTUFA",
        unitType: "UN",
        category: "Hortifruti - Verduras e Folhas"
    },
    {
        pattern: /\bALFACE\s+(CRESPA\s+HIDROP|HIDROPONICA|HIDR)\b/i,
        parentName: "ALFACE CRESPA HIDROPÔNICA",
        unitType: "UN",
        category: "Hortifruti - Verduras e Folhas"
    },
    {
        pattern: /\bALIMENTO\s+ALMOND\s+BRE?E?ZE\b/i,
        parentName: "BEBIDA DE AMÊNDOAS ALMOND BREEZE ORIGINAL",
        unitType: "UN",
        category: "Laticínios - Leites e Derivados"
    },
    {
        pattern: /\bABS\s+HIG\s+INTIMUS\b/i,
        parentName: "ABSORVENTE INTIMUS GEL",
        unitType: "UN",
        category: "Cuidados Pessoais & Beleza"
    }
];

export const calculateSimilarity = (s1: string, s2: string): number => {
    const clean1 = cleanDescriptionForMatching(s1);
    const clean2 = cleanDescriptionForMatching(s2);
    
    if (clean1 === clean2 && clean1.length > 0) return 1.0;
    
    const words1 = clean1.split(' ').filter(w => w.length > 2);
    const words2 = clean2.split(' ').filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    let intersection = 0;
    set1.forEach(w => {
        if (set2.has(w)) intersection++;
    });
    
    const union = new Set([...words1, ...words2]).size;
    return intersection / union;
};

// Auto-generates a MasterProduct from raw parameters
export const createMasterProduct = (
    desc: string,
    unit: string,
    category: string,
    codeIndex: number
): MasterProduct => {
    const code = `MAE${String(codeIndex).padStart(4, '0')}`;
    return {
        code,
        description: desc.toUpperCase().trim(),
        unitType: (unit || 'UN').toUpperCase().trim(),
        category: category || 'Outros',
        aliases: [desc.toUpperCase().trim()],
        establishmentCodes: {}
    };
};

// Pontuação de um nome contra um produto. Nos produtos que a pessoa unificou à mão, vale também
// a semelhança com cada nome que ela juntou: assim o catálogo aprende com o que foi unificado.
const scoreAgainst = (descUpper: string, master: MasterProduct): number => {
    let best = calculateSimilarity(descUpper, master.description);
    if (master.curated) {
        for (const alias of master.aliases) {
            const s = calculateSimilarity(descUpper, alias);
            if (s > best) best = s;
        }
    }
    return best;
};

// Walks through all receipts, aligns them with existing master products,
// automatically learns new ones, and adds aliases/local codes.
//
// Códigos: cada item com código (de barras ou da loja) ensina o produto: o código entra no cadastro dele, e o
// cadastro passa a reconhecer o produto pelo código mesmo quando o nome vier rasurado. Um código que já é de outro
// produto nunca é tomado: quem decide o que fazer com esse conflito é a pessoa.
export const buildAndSyncMasterProducts = (
    receipts: Receipt[],
    existingMasters: MasterProduct[] = []
): MasterProduct[] => {
    // Trabalha numa cópia: mexer nos objetos do estado do React fazia a mudança passar batida e não ser salva.
    const masters: MasterProduct[] = existingMasters.map(m => {
        // Chaves antigas (CNPJ com pontuação, nome da loja) passam para a chave padrão (CNPJ só com dígitos ou "n:nome").
        const codes: Record<string, string | string[]> = {};
        Object.entries(m.establishmentCodes || {}).forEach(([k, v]) => {
            const nk = normStoreKey(k) || k;
            const merged = Array.from(new Set([...codesOf(codes[nk]), ...codesOf(v)]));
            if (merged.length) codes[nk] = merged.length === 1 ? merged[0] : merged;
        });
        return { ...m, aliases: [...(m.aliases || [])], establishmentCodes: codes, ...(m.eans ? { eans: [...m.eans] } : {}), ...(m.noCodes ? { noCodes: [...m.noCodes] } : {}) };
    });
    let nextCodeIndex = masters.length > 0 
        ? Math.max(...masters.map(m => {
            const num = parseInt(m.code.replace('MAE', ''), 10);
            return isNaN(num) ? 0 : num;
        })) + 1
        : 15; // Start at MAE0015 so it aligns conceptually with PRD0015

    // Quem é dono de cada nome de cupom (o primeiro cadastro que o tem)
    const aliasOwner = new Map<string, MasterProduct>();
    const claim = (master: MasterProduct, alias: string) => {
        if (!aliasOwner.has(alias)) aliasOwner.set(alias, master);
    };
    masters.forEach(m => m.aliases.forEach(a => claim(m, a)));

    // Quem é dono de cada código (de barras, ou da loja), para reconhecer o produto e para não tomar código de outro
    const codeIdx = buildCodeIndex(masters);

    receipts.forEach(receipt => {
        const storeKey = normStoreKey(receipt.cnpj || receipt.establishmentName);
        
        (receipt.items || []).forEach(item => {
            const rawDesc = (item.description || '').trim();
            if (!rawDesc) return;
            const descUpper = rawDesc.toUpperCase();
            // Código lido na linha do item; cupons antigos traziam o número colado no começo do nome
            const itemCode = cleanCode(item.code) || cleanCode(leadingCode(rawDesc));
            const unit = (item.unitType || 'UN').trim().toUpperCase();
            const kind = itemCode ? codeKind(itemCode) : null;

            // O que o item ensina ao produto: código de barras do fabricante ou código da loja
            const learnCodes = (master: MasterProduct) => {
                if (!itemCode) return;
                if (kind === 'ean') {
                    if (!codeIdx.byEan.has(toGtin14(itemCode)) && !isBlockedCode(master, noEanKey(itemCode))) { addEan(master, itemCode); indexEan(codeIdx, master, itemCode); }
                } else if (kind === 'store' && storeKey) {
                    if (!codeIdx.byStore.has(`${storeKey}|${itemCode}`) && !isBlockedCode(master, noStoreKey(storeKey, itemCode))) { addStoreCode(master, storeKey, itemCode); indexStoreCode(codeIdx, master, storeKey, itemCode); }
                }
            };

            // O que a pessoa unificou à mão vale mais que as regras automáticas
            const owned = aliasOwner.get(descUpper);
            
            // Step 1: Check expert rules first
            let matched = false;
            if (!owned?.curated) {
                for (const rule of EXPERT_UNIFICATION_RULES) {
                    if (rule.pattern.test(descUpper)) {
                        // Find if a master product already exists with this rule name
                        let master = masters.find(m => m.description === rule.parentName);
                        if (!master) {
                            master = createMasterProduct(rule.parentName, rule.unitType, rule.category, nextCodeIndex++);
                            masters.push(master);
                            master.aliases.forEach(a => claim(master!, a));
                        }
                        
                        if (!master.aliases.includes(descUpper)) {
                            master.aliases.push(descUpper);
                            claim(master, descUpper);
                        }
                        learnCodes(master);
                        matched = true;
                        break;
                    }
                }
            }
            
            if (matched) return;

            // Step 2: Check if exact rawDesc is already an alias in an existing master product
            let foundMaster = owned;

            // Step 2b: o código do produto, quando o nome ainda não é conhecido (cortado, rasurado ou escrito de outro jeito)
            if (!foundMaster && itemCode) {
                const byCode = identifyByCode(itemCode, storeKey, descUpper, codeIdx, looseSimilarity);
                if (byCode && (byCode.hit.via === 'ean' || byCode.hit.via === 'store')) {
                    foundMaster = byCode.hit.master;
                    if (!foundMaster.aliases.includes(descUpper)) {
                        foundMaster.aliases.push(descUpper);
                        claim(foundMaster, descUpper);
                    }
                }
            }
            
            if (!foundMaster) {
                // Step 3: Check by clean similarity
                let bestMatch: MasterProduct | null = null;
                let bestScore = 0;
                
                for (const master of masters) {
                    // Only match if in same category or close (to avoid cross-category grouping)
                    const score = scoreAgainst(descUpper, master);
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = master;
                    }
                }
                
                // If similarity is high (>= 0.70), we merge/learn
                if (bestMatch && bestScore >= 0.70) {
                    foundMaster = bestMatch;
                    if (!foundMaster.aliases.includes(descUpper)) {
                        foundMaster.aliases.push(descUpper);
                        claim(foundMaster, descUpper);
                    }
                }
            }
            
            if (!foundMaster) {
                // Create a completely new Master Product!
                // Make a cleaner version of the rawDesc as the Master Name
                let cleanParentName = descUpper
                    .replace(/^(PRD\d+|PROD\d+|\d+)\b\s*/g, '') // remove codes
                    .replace(/\b\d+\s*(GR|G|ML|L|LT|VOL)\b/gi, '') // remove packaging spec
                    .replace(/\s+/g, ' ')
                    .trim();
                
                if (!cleanParentName) cleanParentName = descUpper;
                
                foundMaster = createMasterProduct(cleanParentName, unit, item.category, nextCodeIndex++);
                if (!foundMaster.aliases.includes(descUpper)) {
                    foundMaster.aliases.push(descUpper);
                }
                masters.push(foundMaster);
                foundMaster.aliases.forEach(a => claim(foundMaster!, a));
            }
            
            learnCodes(foundMaster);
        });
    });
    
    // Sort masters alphabetically by description
    return masters.sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));
};
