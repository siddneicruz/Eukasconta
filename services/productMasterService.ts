import { Receipt, MasterProduct } from '../types';

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
export const buildAndSyncMasterProducts = (
    receipts: Receipt[],
    existingMasters: MasterProduct[] = []
): MasterProduct[] => {
    // Trabalha numa cópia: mexer nos objetos do estado do React fazia a mudança passar batida e não ser salva.
    const masters: MasterProduct[] = existingMasters.map(m => ({
        ...m,
        aliases: [...(m.aliases || [])],
        establishmentCodes: { ...(m.establishmentCodes || {}) }
    }));
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

    receipts.forEach(receipt => {
        const estKey = receipt.cnpj || receipt.establishmentName || 'Geral';
        
        (receipt.items || []).forEach(item => {
            const rawDesc = (item.description || '').trim();
            if (!rawDesc) return;
            const descUpper = rawDesc.toUpperCase();
            const unit = (item.unitType || 'UN').trim().toUpperCase();
            
            // Extract local establishment item code if description has a leading number sequence
            const matchCode = rawDesc.match(/^(\d{3,14})\b/);
            const estCode = matchCode ? matchCode[1] : '';

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
                        if (estCode) {
                            master.establishmentCodes[estKey] = estCode;
                        }
                        matched = true;
                        break;
                    }
                }
            }
            
            if (matched) return;

            // Step 2: Check if exact rawDesc is already an alias in an existing master product
            let foundMaster = owned;
            
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
            
            // Map establishment local code if present
            if (estCode && foundMaster) {
                foundMaster.establishmentCodes[estKey] = estCode;
            }
        });
    });
    
    // Sort masters alphabetically by description
    return masters.sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));
};
