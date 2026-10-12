
import { TaxonomyNode, TaxonomySource, AILearningEntry } from '../types';
import { generateId } from './idUtils';

export const slugify = (text: string) => {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-');
};

/**
 * Resolução de Estilo (The "Smart" Logic)
 * O sistema deve seguir o princípio de "Cascading Styles".
 */
export const resolveNodeStyle = (nodeId: string, nodes: TaxonomyNode[]): { icon: string, color: string } => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return { icon: 'FolderOpen', color: '#D4AF37' };

    // 1. Se o nível atual tem personalização, usa ela.
    let finalIcon = node.icon;
    let finalColor = node.color;

    // 2. Se for nulo, busca recursivamente nos "pais" (Herança)
    let currentNode = node;
    while ((!finalIcon || !finalColor) && currentNode.parentId) {
        const parent = nodes.find(n => n.id === currentNode.parentId);
        if (!parent) break;
        currentNode = parent;
        if (!finalIcon) finalIcon = currentNode.icon;
        if (!finalColor) finalColor = currentNode.color;
    }

    // 3. Fallback
    return {
        icon: finalIcon || 'FolderOpen',
        color: finalColor || '#D4AF37'
    };
};

/**
 * Converte a string de taxonomia legada para a nova estrutura de nós
 */
export const migrateLegacyTaxonomy = (legacyString: string): TaxonomyNode[] => {
    const nodes: TaxonomyNode[] = [];
    const lines = legacyString.split('\n').filter(l => l.trim());
    
    let currentL1: string | null = null;
    let currentL2: string | null = null;
    let currentL3: string | null = null;

    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('CATEGORIA MESTRE:')) {
            const name = trimmed.replace('CATEGORIA MESTRE:', '').trim();
            const id = generateId();
            nodes.push({
                id,
                parentId: null,
                level: 1,
                name,
                slug: slugify(name),
                sourceType: TaxonomySource.SYSTEM,
                isCustomized: false,
                lastUpdated: Date.now()
            });
            currentL1 = id;
            currentL2 = null;
            currentL3 = null;
        } else if (trimmed.startsWith('--- ')) {
            const name = trimmed.substring(4).trim();
            const id = generateId();
            nodes.push({
                id,
                parentId: currentL3,
                level: 4,
                name,
                slug: slugify(name),
                sourceType: TaxonomySource.SYSTEM,
                isCustomized: false,
                lastUpdated: Date.now()
            });
        } else if (trimmed.startsWith('-- ')) {
            const name = trimmed.substring(3).trim();
            const id = generateId();
            nodes.push({
                id,
                parentId: currentL2,
                level: 3,
                name,
                slug: slugify(name),
                sourceType: TaxonomySource.SYSTEM,
                isCustomized: false,
                lastUpdated: Date.now()
            });
            currentL3 = id;
        } else if (trimmed.startsWith('- ')) {
            const fullName = trimmed.substring(2).trim();
            const parts = fullName.split(' - ');
            const name = parts.length > 1 ? parts[parts.length - 1] : parts[0];
            const id = generateId();
            nodes.push({
                id,
                parentId: currentL1,
                level: 2,
                name,
                slug: slugify(fullName),
                sourceType: TaxonomySource.SYSTEM,
                isCustomized: false,
                lastUpdated: Date.now()
            });
            currentL2 = id;
            currentL3 = null;
        }
    });

    return nodes;
};

export const syncMissingDefaultTaxonomy = (existingNodes: TaxonomyNode[], defaultString: string): TaxonomyNode[] => {
    const defaultNodes = migrateLegacyTaxonomy(defaultString);
    const existingSlugs = new Set(existingNodes.map(n => n.slug));
    
    // Simplistic approach: if a L1 (Master category) from default is completely missing in existing, add it and its children.
    const missingMasterNodes = defaultNodes.filter(n => n.level === 1 && !existingSlugs.has(n.slug));
    
    if (missingMasterNodes.length === 0) return existingNodes;

    const merged = [...existingNodes];
    
    missingMasterNodes.forEach(master => {
        merged.push(master);
        // Find all descendants of this master node in defaultNodes
        const addDescendants = (parentId: string) => {
            const children = defaultNodes.filter(n => n.parentId === parentId);
            children.forEach(child => {
                merged.push(child);
                addDescendants(child.id);
            });
        };
        addDescendants(master.id);
    });

    return merged;
};

// ---------------------------------------------------------------------
// Nivelamento (leveling): reconcilia a árvore que o usuário já tem com uma
// árvore "de referência" (o padrão de fábrica, ou uma planilha importada) —
// nível a nível, pelo caminho completo (slugs do pai até a raiz), não só
// pelo topo. Ao contrário do syncMissingDefaultTaxonomy acima (que só olha
// departamentos totalmente ausentes), isso detecta uma categoria, subcategoria
// ou item novo mesmo dentro de um departamento que o usuário já tinha —
// sem duplicar o que já existe e sem tocar em nada que o usuário já tem.
export const levelTaxonomy = (
    existingNodes: TaxonomyNode[],
    referenceNodes: TaxonomyNode[]
): { merged: TaxonomyNode[]; addedCount: number } => {
    const pathKey = (node: TaxonomyNode, nodes: TaxonomyNode[]): string => {
        const parts: string[] = [];
        let current: TaxonomyNode | undefined = node;
        while (current) {
            parts.unshift(current.slug);
            current = current.parentId ? nodes.find(n => n.id === current!.parentId) : undefined;
        }
        return parts.join('/');
    };

    const merged: TaxonomyNode[] = [...existingNodes];
    const pathToId = new Map<string, string>();
    existingNodes.forEach(n => pathToId.set(pathKey(n, existingNodes), n.id));

    // Processa em ordem de nível (1 a 4) para garantir que o pai já foi
    // resolvido (existente ou recém-criado) antes de tentar achar o filho.
    const ordered = [...referenceNodes].sort((a, b) => a.level - b.level);
    let addedCount = 0;

    ordered.forEach(refNode => {
        const key = pathKey(refNode, referenceNodes);
        if (pathToId.has(key)) return; // já existe no caminho completo — não duplica

        const parentKey = refNode.parentId
            ? pathKey(referenceNodes.find(n => n.id === refNode.parentId)!, referenceNodes)
            : null;
        const parentId = parentKey ? pathToId.get(parentKey) ?? null : null;

        // Pai ainda não resolvido (não deveria acontecer, dada a ordenação por nível,
        // mas por segurança pula em vez de criar um nó órfão).
        if (refNode.parentId && !parentId) return;

        const newNode: TaxonomyNode = {
            ...refNode,
            id: generateId(),
            parentId,
        };
        merged.push(newNode);
        pathToId.set(key, newNode.id);
        addedCount++;
    });

    return { merged, addedCount };
};

export const findBestMatch = (keyword: string, nodes: TaxonomyNode[], learning: AILearningEntry[]): TaxonomyNode | null => {
    const normalized = keyword.toLowerCase().trim();
    
    // 1. Check learning table
    const learned = learning.find(l => l.keyword === normalized);
    if (learned) return nodes.find(n => n.id === learned.targetNodeId) || null;

    // 2. Direct slug match
    const direct = nodes.find(n => n.slug === slugify(normalized) || n.name.toLowerCase() === normalized);
    if (direct) return direct;

    // 3. Fuzzy match (simple)
    return nodes.find(n => normalized.includes(n.name.toLowerCase())) || null;
};
