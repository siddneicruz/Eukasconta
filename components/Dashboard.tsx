
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Receipt, DashboardConfig, DEFAULT_CATEGORIES, TaxonomyNode, MasterProduct } from '../types';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid, BarChart, Bar, LabelList } from 'recharts';
import InteractiveDonut from './InteractiveDonut';
import PercentRing from './PercentRing';
import PeriodPicker from './PeriodPicker';
import ReceiptRow from './ReceiptRow';
import ItemSearchBox from './ItemSearchBox';
import ItemPriceInsight from './ItemPriceInsight';
import { useStoreNames } from './StoreNamesContext';
import { 
    Calendar, Fuel, Home, Shirt, ShoppingCart, ScanLine, History, 
    BarChart3, Settings, Filter, CalendarDays, RotateCcw, 
    Beef, Bird, Fish, PiggyBank, Brush, Milk, Waves, Baby, Smartphone, MoveHorizontal, Carrot,
    Gem, ChevronDown, Coffee, Wine, Pizza, Candy, IceCream, Utensils, Laptop, PenTool, Wrench,
    TrendingUp, LineChart, Croissant, CakeSlice, Cookie, Wheat, ChefHat, Palette, Store, Clock, ChevronRight,
    Egg, Apple, Cherry, Salad, Beer, CupSoda, Eraser, Zap, PawPrint, ShoppingBag,
    Banana, Grape, Citrus, LeafyGreen,
    Shrimp, Drumstick, Sandwich, Popcorn, Donut, Lollipop, Martini, GlassWater,
    Cigarette, Watch, Briefcase, Footprints, Glasses, Umbrella, Backpack, Sparkles,
    Sprout, Leaf, Flower2, Circle, Droplets, Bean, Bath, Smile, Heart, HeartPulse,
    Pill, Stethoscope, Activity, Bandage, Thermometer, Scissors, Sun, Moon,
    Wind, Cloud, CloudRain, Battery, Hammer,
    Bed, Lamp, Refrigerator, Fan, Monitor, Tv, Headphones,
    Speaker, Camera, Cpu, Binary, Code, Keyboard, Mouse, Wifi, Bluetooth, HardDrive,
    Coins, CreditCard, Wallet, Banknote, Landmark, PieChart as PieChartIcon, BarChart4,
    Target, Calculator, Lock, Key, Shield, Receipt as ReceiptIcon, Car, Plane, Bike,
    Bus, Truck, Ship, MapPin, Navigation, Container, Bone, Cat,
    Dog, Rabbit, Turtle, Snail, Bug, Trophy, Medal, Dumbbell, Book, Languages,
    GraduationCap, Library, Notebook, Box, Package, Archive, Soup,
    Lightbulb, Scroll, Flame, PartyPopper, Recycle, Vegan, Snowflake, ArrowLeftRight
} from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { TL_AXIS_Y_WIDTH, TL_MARGIN_RIGHT as TIMELINE_MARGIN_RIGHT, renderTimelineTick, renderTimelineYTick, useElementWidth } from '../services/chartFormat';
import { buildEvolution } from '../services/evolutionSeries';
import DeptFilterSheet from './DeptFilterSheet';
import { useLayers } from './LayersContext';
import { useDeptFilter, isDeptFilterActive, invertDeptFilter, deptFilterLabel, deptLabelFor, applyDeptFilter, buildDeptOptions } from '../services/deptFilter';
import { projectReceipts, makeItemMatcher, toHistoryItems, itemFilterTitle } from '../services/itemSearch';
import { periodLabel } from '../services/productPriceStats';
import { isCurrentMonthPeriod } from '../services/currentMonth';
import { titleCase, properCase, shortLabels, isUnidentifiedName, UNIDENTIFIED_LABEL, deptKey, sameDept } from '../services/textFormat';

interface DashboardProps {
  receipts: Receipt[];
  taxonomy: TaxonomyNode[];
  config: DashboardConfig;
  onConfigChange: (config: DashboardConfig) => void;
  onCategoryClick?: (category: string) => void;
  onScanClick: () => void;
  onHistoryClick: () => void;
  onReportsClick: () => void;
  onSettingsClick: () => void;
  onEditIcon?: (category: string) => void;
  onSelectReceipt?: (receipt: Receipt) => void;
  masterProducts?: MasterProduct[];
}

const MONTHS_SHORT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const CHART_COLORS = ['#D4AF37', '#27A46D', '#3B82F6', '#EC4899', '#F59E0B', '#8B5CF6', '#10B981', '#EF4444', '#06B6D4', '#6366F1'];

// Período em poucas letras para a barra de filtros fechada ("Mai 2026", "Ano 2026", "7 dias", "01/05 a 15/05").
const shortPeriod = (c: DashboardConfig): string => {
    if (c.quickFilter === '7d') return '7 dias';
    if (c.quickFilter === '30d') return '30 dias';
    if (c.quickFilter === 'custom') {
        const dm = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');
        if (c.customStartDate && c.customEndDate) return `${dm(c.customStartDate)} a ${dm(c.customEndDate)}`;
        return 'Período';
    }
    // mês atual: do dia 1 até hoje ("01/10 a 15/10"); cresce um dia a cada dia até fechar o mês
    if (isCurrentMonthPeriod(c)) {
        const t = new Date();
        const p2 = (n: number) => String(n).padStart(2, '0');
        return `01/${p2(t.getMonth() + 1)} a ${p2(t.getDate())}/${p2(t.getMonth() + 1)}`;
    }
    if (c.month !== null && c.month !== undefined) return `${MONTHS_SHORT[c.month].charAt(0)}${MONTHS_SHORT[c.month].slice(1).toLowerCase()} ${c.year}`;
    return `Ano ${c.year}`;
};

export const getCustomMeta = (category: string) => {
    try {
        const stored = localStorage.getItem('eukasconta_category_meta');
        if (stored) {
            const meta = JSON.parse(stored);
            if (meta[category.trim()]) return meta[category.trim()];
            const masterKey = category.split(' - ')[0].trim(); 
            if (meta[masterKey]) return meta[masterKey];
        }
    } catch(e) {}
    return null;
};

// Só a correspondência por palavra-chave, sem verificar personalização nem
// aplicar o ícone padrão — retorna null quando nada bate, para quem chama
// (ex: a herança de hierarquia da Taxonomia) saber que precisa continuar
// procurando em vez de aceitar um "ShoppingBag" genérico como resposta.
export const matchIconByKeyword = (category: string): any => {
    const norm = category.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // ===== Taxonomia de Supermercado (18 departamentos) =====
    // Nomes de departamento/categoria por extenso vêm primeiro, antes das
    // palavras soltas mais genéricas mais abaixo, para não perder pra elas.
    if (norm.includes('acougue') && (norm.includes('peixaria') || norm.includes('pescado'))) return Beef;
    if (norm.includes('acougue')) return Beef;
    if (norm.includes('cordeiro') || norm.includes('caprinos') || norm.includes('exoticos')) return Beef;
    if (norm.includes('churrasco') || norm.includes('espeto')) return Flame;
    if (norm.includes('peixaria') || norm.includes('bacalhau')) return Fish;
    if (norm.includes('cortes nobres') || norm.includes('corte nobre')) return Beef;

    if (norm.includes('frios e laticinios')) return Milk;
    if (norm.includes('laticinios') || norm.includes('queijo') || norm.includes('manteiga') || norm.includes('requeijao') || norm.includes('margarina')) return Milk;
    if (norm.includes('embutido') || norm.includes('frios')) return Sandwich;

    if (norm.includes('hortifruti')) return Salad;
    if (norm.includes('frutas')) return Apple;
    if (norm.includes('legumes')) return Carrot;
    if (norm.includes('verduras') || norm.includes('folhas')) return LeafyGreen;
    if (norm.includes('organicos')) return Leaf;
    if (norm.includes('minimamente processados')) return Salad;

    if (norm.includes('padaria e confeitaria')) return Croissant;
    if (norm.includes('confeitaria')) return CakeSlice;

    if (norm.includes('mercearia basica')) return Wheat;
    if (norm.includes('mercearia doce') || norm.includes('matinais')) return Cookie;
    if (norm.includes('mercearia salgada') || norm.includes('conservas')) return Soup;
    if (norm.includes('sal e temperos') || norm.includes('especiarias')) return Palette;

    if (norm.includes('bebidas funcionais')) return HeartPulse;
    if (norm.includes('mixers') || norm.includes('gelo')) return GlassWater;
    if (norm.includes('destilados') || norm.includes('licores')) return Martini;
    if (norm.includes('bebidas')) return CupSoda;

    if (norm.includes('congelados')) return Snowflake;
    if (norm.includes('empanados') || norm.includes('processados')) return Drumstick;

    if (norm.includes('saudaveis e especiais')) return HeartPulse;
    if (norm.includes('sem gluten') || norm.includes('sem lactose')) return Activity;
    if (norm.includes('vegano') || norm.includes('vegetariano')) return Vegan;
    if (norm.includes('suplementos') || norm.includes('nutricao esportiva')) return Dumbbell;
    if (norm.includes('diet') || norm.includes('light') || norm.includes('zero')) return Activity;
    if (norm.includes('a granel') || norm.includes('produtos naturais')) return Leaf;

    if (norm.includes('mundo infantil') || norm.includes('alimentacao infantil')) return Baby;

    if (norm.includes('higiene e perfumaria') || norm.includes('perfumaria')) return Sparkles;
    if (norm.includes('barbear') || norm.includes('depilacao')) return Scissors;
    if (norm.includes('farmacia basica')) return Pill;
    if (norm.includes('higiene intima')) return Droplets;
    if (norm.includes('rosto') || norm.includes('maquiagem')) return Sparkles;

    if (norm.includes('cuidados com roupas')) return Shirt;
    if (norm.includes('ambiente e controle de pragas') || norm.includes('pragas')) return Bug;
    if (norm.includes('descartaveis') || norm.includes('embalagens')) return Recycle;

    if (norm.includes('pet shop') || norm.includes('acessorios pet')) return PawPrint;
    if (norm.includes('caes')) return Dog;
    if (norm.includes('gatos')) return Cat;

    if (norm.includes('bazar e utilidades') || norm.includes('utensilios de cozinha')) return Home;
    if (norm.includes('mesa e copa')) return Utensils;
    if (norm.includes('casa e organizacao')) return Archive;
    if (norm.includes('eletricos e iluminacao')) return Lightbulb;
    if (norm.includes('papelaria')) return Notebook;
    if (norm.includes('automotivo')) return Car;
    if (norm.includes('jardinagem')) return Sprout;
    if (norm.includes('sazonais') || norm.includes('festas')) return PartyPopper;

    if (norm.includes('tabacaria')) return Cigarette;
    if (norm.includes('conveniencia')) return Store;

    if (norm.includes('rotisseria') || norm.includes('comida pronta') || norm.includes('pratos quentes') || norm.includes('assados')) return ChefHat;
    if (norm.includes('culinaria oriental')) return Utensils;
    if (norm.includes('saladas e sanduiches prontos')) return Sandwich;

    // Gastronomia & Produtos Específicos
    if (norm.includes('bolo') || norm.includes('torta')) return CakeSlice;
    if (norm.includes('biscoito') || norm.includes('cookie') || norm.includes('bolacha')) return Cookie;
    if (norm.includes('pao') || norm.includes('padaria') || norm.includes('baguete') || norm.includes('bisnaguinha')) return Croissant;
    if (norm.includes('farinha') || norm.includes('trigo') || norm.includes('massa') || norm.includes('macarrao') || norm.includes('lasanha')) return Wheat;
    if (norm.includes('arroz') || norm.includes('feijao') || norm.includes('grao') || norm.includes('lentilha') || norm.includes('grao-de-bico')) return Bean;
    if (norm.includes('tempero') || norm.includes('condimento') || norm.includes('sal') || norm.includes('pimenta') || norm.includes('caldo')) return Palette;
    if (norm.includes('oleo') || norm.includes('azeite') || norm.includes('vinagre')) return Droplets;
    if (norm.includes('acucar') || norm.includes('adocante')) return Candy;
    if (norm.includes('confeitaria')) return ChefHat;
    if (norm.includes('bomboniere') || norm.includes('chocolate') || norm.includes('doce') || norm.includes('bala') || norm.includes('chiclete')) return Candy;
    if (norm.includes('sorvete') || norm.includes('acai')) return IceCream;
    if (norm.includes('snack') || norm.includes('salgadinho') || norm.includes('batata palha') || norm.includes('doritos') || norm.includes('cheetos')) return Pizza;
    if (norm.includes('pipoca')) return Popcorn;
    if (norm.includes('donut')) return Donut;
    if (norm.includes('pirulito')) return Lollipop;
    if (norm.includes('cafe') || norm.includes('nespresso') || norm.includes('capsula') || norm.includes('matinais')) return Coffee;
    if (norm.includes('cha') || norm.includes('infusao')) return CupSoda;
    if (norm.includes('leite') || norm.includes('iogurte') || norm.includes('danone') || norm.includes('coalhada')) return Milk;
    if (norm.includes('queijo') || norm.includes('manteiga') || norm.includes('requeijao') || norm.includes('margarina')) return Utensils;
    if (norm.includes('carne') || norm.includes('bovino') || norm.includes('picanha') || norm.includes('alcatra') || norm.includes('file') || norm.includes('maminha') || norm.includes('fraldinha') || norm.includes('cupim') || norm.includes('acem') || norm.includes('patinho')) return Beef;
    if (norm.includes('suino') || norm.includes('porco') || norm.includes('bacon') || norm.includes('linguica') || norm.includes('salsicha') || norm.includes('lombo') || norm.includes('pernil') || norm.includes('panceta')) return PiggyBank;
    if (norm.includes('aves') || norm.includes('frango') || norm.includes('sobrecoxa') || norm.includes('peito') || norm.includes('coxa') || norm.includes('peru') || norm.includes('pato')) return Bird;
    if (norm.includes('frango') && (norm.includes('coxa') || norm.includes('asa'))) return Drumstick;
    if (norm.includes('pescado') || norm.includes('peixe') || norm.includes('salmao') || norm.includes('tilapia')) return Fish;
    if (norm.includes('camarao') || norm.includes('lagosta')) return Shrimp;
    if (norm.includes('ovo')) return Egg;
    if (norm.includes('sanduiche') || norm.includes('hamburguer')) return Sandwich;
    
    // Hortifruti - Muito mais específico
    if (norm.includes('banana')) return Banana;
    if (norm.includes('uva')) return Grape;
    if (norm.includes('morango') || norm.includes('amora') || norm.includes('framboesa') || norm.includes('pitaya')) return Cherry; 
    if (norm.includes('laranja') || norm.includes('limao') || norm.includes('mexerica') || norm.includes('tangerina') || norm.includes('citrico')) return Citrus;
    if (norm.includes('maca') || norm.includes('pera')) return Apple;
    if (norm.includes('manga') || norm.includes('mamao') || norm.includes('abacate') || norm.includes('pessego') || norm.includes('ameixa') || norm.includes('nectarina') || norm.includes('caqui')) return Citrus; // Citrus looks more like a round generic fruit than Apple
    if (norm.includes('cereja')) return Cherry;
    if (norm.includes('abacaxi')) return Zap; // Zap crown looks like pineapple top
    if (norm.includes('melancia') || norm.includes('coco') || norm.includes('maracuja') || norm.includes('melao')) return Circle; 
    
    if (norm.includes('cenoura')) return Carrot;
    if (norm.includes('batata') || norm.includes('mandioca') || norm.includes('mandioquinha') || norm.includes('inhame') || norm.includes('batata-doce')) return Carrot; 
    if (norm.includes('tomate') || norm.includes('pimentao') || norm.includes('berinjela') || norm.includes('abobora') || norm.includes('chuchu') || norm.includes('jilo')) return Circle; 
    if (norm.includes('cebola') || norm.includes('alho')) return Flower2; 
    if (norm.includes('cogumelo') || norm.includes('shimeji') || norm.includes('shitake')) return Sprout;
    if (norm.includes('milho')) return Wheat; 
    if (norm.includes('alface') || norm.includes('couve') || norm.includes('espinafre') || norm.includes('rucula') || norm.includes('acelga') || norm.includes('agriao')) return LeafyGreen;
    if (norm.includes('salada') || norm.includes('brocolis') || norm.includes('repolho') || norm.includes('couve-flor')) return Salad;
    if (norm.includes('noz') || norm.includes('castanha') || norm.includes('amendoim') || norm.includes('pistache') || norm.includes('amendoa')) return Leaf;
    
    // Cuidados Pessoais
    if (norm.includes('esmalte') || norm.includes('unha') || norm.includes('mao') || norm.includes('pe')) return Sparkles;
    if (norm.includes('shampoo') || norm.includes('condicionador') || norm.includes('cabelo')) return Waves;
    if (norm.includes('sabonete')) return Bath;
    if (norm.includes('creme dental') || norm.includes('escova') || norm.includes('oral')) return Smile;

    // Bebidas
    if (norm.includes('vinho') || norm.includes('espumante')) return Wine;
    if (norm.includes('cerveja') || norm.includes('chopp')) return Beer;
    if (norm.includes('refrigerante') || norm.includes('suco') || norm.includes('cha')) return CupSoda;
    if (norm.includes('agua') || norm.includes('tonica')) return GlassWater;
    if (norm.includes('drink') || norm.includes('gin') || norm.includes('vodka')) return Martini;
    
    // Casa & Limpeza
    if (norm.includes('vassoura') || norm.includes('rodo') || norm.includes('limpeza') || norm.includes('desinfetante')) return Brush;
    if (norm.includes('sabao') || norm.includes('detergente') || norm.includes('amaciante')) return Waves;
    if (norm.includes('papel higienico') || norm.includes('guardanapo')) return Scroll;
    if (norm.includes('lampada') || norm.includes('energia') || norm.includes('pilha') || norm.includes('bateria')) return Lightbulb;
    if (norm.includes('casa') || norm.includes('decoracao')) return Home;

    // Tecnologia & Outros
    if (norm.includes('transporte') || norm.includes('combustivel') || norm.includes('gasolina') || norm.includes('etanol') || norm.includes('diesel')) return Fuel;
    if (norm.includes('roupa') || norm.includes('moda') || norm.includes('camiseta') || norm.includes('calca') || norm.includes('bermuda')) return Shirt;
    if (norm.includes('sapato') || norm.includes('tenis') || norm.includes('chinelo')) return Footprints;
    if (norm.includes('bebe') || norm.includes('fralda') || norm.includes('infantil')) return Baby;
    if (norm.includes('eletronico') || norm.includes('celular') || norm.includes('fone')) return Smartphone;
    if (norm.includes('computador') || norm.includes('monitor')) return Monitor;
    if (norm.includes('ferramenta') || norm.includes('parafuso')) return Wrench;
    if (norm.includes('pet') || norm.includes('racao') || norm.includes('cachorro') || norm.includes('gato')) return PawPrint;
    if (norm.includes('relogio') || norm.includes('joia')) return Watch;
    if (norm.includes('oculos')) return Glasses;
    if (norm.includes('mochila') || norm.includes('bolsa')) return Backpack;
    if (norm.includes('guarda-chuva')) return Umbrella;
    if (norm.includes('cigarro') || norm.includes('fumo') || norm.includes('tabaco')) return Cigarette;
    if (norm.includes('luxo') || norm.includes('premium') || norm.includes('vip')) return Sparkles;

    return null;
};

export const getCategoryIcon = (category: string) => {
    const custom = getCustomMeta(category);
    if (custom && custom.icon) {
        if (custom.icon.startsWith('data:image/')) {
            return (props: any) => <img src={custom.icon} className={props.className} style={{ width: '1em', height: '1em', objectFit: 'contain', mixBlendMode: 'screen', ...props.style }} alt={category} />;
        }
        // @ts-ignore
        const IconComp = LucideIcons[custom.icon];
        if (IconComp) return IconComp;
    }
    return matchIconByKeyword(category) || ShoppingBag;
};

export const getCategoryColor = (category: string) => {
    // 1. Tentar cor customizada EXATA primeiro
    try {
        const stored = localStorage.getItem('eukasconta_category_meta');
        if (stored) {
            const meta = JSON.parse(stored);
            if (meta[category.trim()]?.color) return meta[category.trim()].color;
        }
    } catch(e) {}
    
    const norm = category.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    // 2. Cores por palavras-chave ultra-específicas
    if (norm.includes('carne') || norm.includes('bovino')) return '#EF4444'; 
    if (norm.includes('frango') || norm.includes('ave')) return '#F87171'; 
    if (norm.includes('suino') || norm.includes('porco')) return '#F472B6'; 
    if (norm.includes('peixe') || norm.includes('mar')) return '#06B6D4'; 
    if (norm.includes('vegetal') || norm.includes('legume') || norm.includes('horta')) return '#22C55E'; 
    if (norm.includes('fruta')) return '#FACC15'; 
    if (norm.includes('banana')) return '#FDE047'; 
    if (norm.includes('abacaxi')) return '#FDE047';
    if (norm.includes('mamao')) return '#FB923C';
    if (norm.includes('uva')) return '#A855F7'; 
    if (norm.includes('morango')) return '#FB7185'; 
    if (norm.includes('laranja')) return '#FB923C'; 
    if (norm.includes('limao')) return '#84CC16'; 
    if (norm.includes('tomate')) return '#EF4444';
    if (norm.includes('alface')) return '#4ADE80';
    if (norm.includes('doce') || norm.includes('sobremesa') || norm.includes('chocolate')) return '#EC4899'; 
    if (norm.includes('bebida') || norm.includes('liquido')) return '#3B82F6'; 
    if (norm.includes('cerveja')) return '#F59E0B'; 
    if (norm.includes('vinho')) return '#7F1D1D'; 
    if (norm.includes('limpeza')) return '#8B5CF6'; 
    if (norm.includes('tecnologia')) return '#6366F1'; 
    if (norm.includes('combustivel')) return '#F59E0B'; 
    if (norm.includes('padaria')) return '#D97706'; 
    if (norm.includes('leite') || norm.includes('queijo')) return '#10B981'; 
    if (norm.includes('luxo') || norm.includes('premium')) return '#D4AF37'; 
    if (norm.includes('unha') || norm.includes('esmalte')) return '#EC4899';
    if (norm.includes('cabelo')) return '#6366F1';
    
    // 3. Despensa & Grãos (Multicolorido por sub-palavras)
    if (norm.includes('tempero') || norm.includes('condimento')) return '#F97316'; 
    if (norm.includes('oleo') || norm.includes('azeite')) return '#EAB308'; 
    if (norm.includes('farinha') || norm.includes('acucar')) return '#FDE68A'; 
    if (norm.includes('massa') || norm.includes('molho')) return '#DC2626'; 
    if (norm.includes('arroz') || norm.includes('feijao')) return '#78350F'; 
    if (norm.includes('matinais') || norm.includes('cafe')) return '#451A03'; 

    // 4. Se for uma subcategoria (contém " - "), forçar multicores determinístico
    if (category.includes(' - ')) {
        const subName = category.split(' - ').slice(1).join(' - ');
        let hash = 0;
        for (let i = 0; i < subName.length; i++) {
            hash = subName.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = Math.abs(hash % 360);
        return `hsl(${hue}, 75%, 60%)`;
    }

    // 5. Mapeamento de Categorias Mestras (incluindo customizada do mestre)
    const key = category.split(' - ')[0].trim();
    const custom = getCustomMeta(key);
    if (custom && custom.color) return custom.color;

    const COLORS: Record<string, string> = {
        'Transporte': '#466C8C', 'Hortifruti': '#27A46D', 'Laticínios e Frios': '#17FF7C',
        'Moda': '#E6199F', 'Carne Suína': '#9F4D19', 'Carne Bovina': '#D03F33',
        'Adega e Bebidas': '#2AEBCE', 'Bomboniere e Snacks': '#FF69B4',
        'Padaria e Confeitaria': '#D2691E', 'Higiene e Beleza': '#EC4899',
        'Limpeza e Casa': '#8B5CF6', 'Despensa e Grãos': '#B9A329', 'Despensa': '#B9A329',
        'Bazar e Outros': '#607D8B', 'Pet Shop': '#FF9800'
    };
    
    if (COLORS[key]) return COLORS[key];

    // 6. Fallback Final
    let hash = 0;
    for (let i = 0; i < category.length; i++) {
        hash = category.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 60%, 50%)`;
};

// Encurta o nome do estabelecimento pro gráfico: tira palavras genéricas que
// não ajudam a identificar QUAL loja é (todo mundo tem um "Supermercado" ou
// "Auto Posto" no nome; o que diferencia é o resto) e corta em ~15 caracteres.
// Frases inteiras (não só palavras soltas) removidas do nome antes de exibir —
// por isso 'auto posto' precisa vir ANTES de 'posto' na lista: se 'posto'
// fosse removido primeiro, sobraria um 'auto' solto e sem sentido.
const GENERIC_ESTABLISHMENT_PHRASES = [
  'auto posto', 'posto', 'supermercado', 'mercearia', 'padaria', 'cooperativa', 'atacadista',
  'comercio', 'comercial', 'distribuidora', 'armazem', 'mercado', 'minimercado',
  'hipermercado', 'ltda', 'eireli', 's/a',
];
// Nome da loja sem as palavras genéricas ("Supermercado", "Ltda"...). Devolve o nome inteiro limpo;
// quem precisa de um rótulo curto usa shortLabels (primeira palavra, mais palavras só se houver repetição).
const cleanEstablishmentName = (name: string): string => {
  if (isUnidentifiedName(name)) return UNIDENTIFIED_LABEL;
  const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let cleaned = stripAccents(name);
  GENERIC_ESTABLISHMENT_PHRASES.forEach(phrase => {
    cleaned = cleaned.replace(new RegExp(`\\b${phrase}\\b`, 'gi'), ' ');
  });
  return cleaned.replace(/\s+/g, ' ').trim() || name.trim();
};

const clip = (text: string, maxLen: number): string =>
  text.length > maxLen ? `${text.slice(0, maxLen - 1).trim()}…` : text;

const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-zinc-950 border border-white/10 px-3 py-2 rounded-xl shadow-xl backdrop-blur-md">
                <p className="text-luxury-gold text-[11px] font-semibold leading-none">{data.label || data.name}</p>
                <p className="text-white font-serif text-[15px] leading-none mt-1.5 tabular-nums">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.value)}</p>
                {data.percentage && <p className="text-zinc-400 text-[11px] mt-1">{data.percentage.toFixed(1).replace('.', ',')}% do total</p>}
            </div>
        );
    }
    return null;
};

const Dashboard: React.FC<DashboardProps> = ({ receipts, taxonomy, config, onConfigChange, onCategoryClick, onScanClick, onHistoryClick, onReportsClick, onSettingsClick, onEditIcon, onSelectReceipt, masterProducts = [] }) => {
  const [hoveredEstIdx, setHoveredEstIdx] = useState<number | null>(null);
  // No celular a barra de filtros fica numa linha só (categoria + período); toca no período para abrir o resto.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Filtro de categorias: fica gravado no aparelho (não some ao limpar os outros filtros)
  const [deptFilter, setDeptFilter] = useDeptFilter();
  const layers = useLayers();   // grupos e itens (camadas 3 e 4) da estrutura de categorias
  const [deptSheetOpen, setDeptSheetOpen] = useState(false);
  const deptActive = isDeptFilterActive(deptFilter);
  const hasFilters = !!(!isCurrentMonthPeriod(config) || config.establishment || config.item);
  const resetFilters = () => onConfigChange({ year: new Date().getFullYear(), month: new Date().getMonth(), category: null, quickFilter: null, customStartDate: '', customEndDate: '', establishment: null, item: null });
  // Partes que só aparecem com a barra aberta no celular (no computador e no celular deitado ficam sempre)
  const moreCls = filtersOpen ? 'flex' : 'hidden md:flex ls:flex';
  const { aliasOf, nameOf, keyOf } = useStoreNames();
  const availableMasterCategories = useMemo(() => {
      return taxonomy
        .filter(n => n.level === 1)
        .map(n => n.name)
        .sort();
  }, [taxonomy]);

  // Com um item escolhido na busca, cada cupom passa a ter só as linhas desse item (e o total dessas linhas):
  // o painel inteiro (linha do tempo, departamentos, lojas, lista) reflete só ele.
  const itemReceipts = useMemo(() => projectReceipts(receipts, config.item), [receipts, config.item]);
  const receiptsById = useMemo(() => new Map(receipts.map(r => [r.id, r] as [string, Receipt])), [receipts]);

  // Período, loja e item (ainda sem o filtro de categorias: a folha de categorias mostra quanto cada uma gastou aqui)
  const periodReceipts = useMemo(() => {
    return itemReceipts.filter(r => {
        let rDate = new Date(r.date + 'T12:00:00');
        if (isNaN(rDate.getTime())) rDate = new Date();
        
        if (config.establishment && keyOf(r.establishmentName, r.cnpj) !== config.establishment) return false;

        if (config.quickFilter === 'custom') {
            if (config.customStartDate && r.date < config.customStartDate) return false;
            if (config.customEndDate && r.date > config.customEndDate) return false;
            return true;
        }
        if (config.quickFilter === '7d' || config.quickFilter === '30d') {
            const days = config.quickFilter === '7d' ? 7 : 30;
            const limit = new Date();
            limit.setDate(limit.getDate() - days);
            return rDate >= limit;
        }
        
        if (rDate.getFullYear() !== config.year) return false;
        if (config.month !== null && rDate.getMonth() !== config.month) return false;
        return true;
    });
  }, [itemReceipts, config, keyOf]);

  // Com categorias tiradas (ou só algumas escolhidas), cada cupom fica só com as linhas que entram, e vale a soma delas
  const filteredReceipts = useMemo(
    () => [...applyDeptFilter(periodReceipts, deptFilter, layers)].sort((a, b) => b.date.localeCompare(a.date)),
    [periodReceipts, deptFilter, layers]);
  const deptOptions = useMemo(() => buildDeptOptions(receipts, periodReceipts, layers), [receipts, periodReceipts, layers]);
  const deptLabel = deptFilterLabel(deptFilter, k => deptLabelFor(deptOptions, k));

  // Resumo do item escolhido no período, e as compras dele para o gráfico de preço
  const itemSummary = useMemo(() => {
    if (!config.item) return null;
    let lines = 0, total = 0;
    filteredReceipts.forEach(r => r.items.forEach(i => { lines += 1; total += Number(i.totalPrice) || 0; }));
    return { lines, total };
  }, [config.item, filteredReceipts]);
  const itemHistory = useMemo(
    () => (config.item ? toHistoryItems(filteredReceipts, makeItemMatcher(config.item), nameOf) : []),
    [config.item, filteredReceipts, nameOf]);
  const openOriginal = (r: Receipt) => onSelectReceipt?.(receiptsById.get(r.id) || r);

  // Departamentos: "HORTIFRUTI", "Hortifruti" e "hortifruti" (ou com/sem acento) viram um só.
  // O nome que representa o grupo é o da taxonomia, se existir; senão o que mais gastou.
  const { chartData, totalSpent } = useMemo(() => {
    const byKey = new Map<string, { total: number; variants: Map<string, number> }>();
    const official = new Map<string, string>();
    availableMasterCategories.forEach(n => official.set(deptKey(n), n));
    let total = 0;
    filteredReceipts.forEach(receipt => {
        receipt.items.forEach(item => {
            const raw = (item.category || 'Bazar e Outros').split(' - ')[0].trim() || 'Bazar e Outros';
            const key = deptKey(raw);
            const price = Number(item.totalPrice) || 0;
            let g = byKey.get(key);
            if (!g) { g = { total: 0, variants: new Map() }; byKey.set(key, g); }
            g.total += price;
            g.variants.set(raw, (g.variants.get(raw) || 0) + price);
            total += price;
        });
    });
    const rows = Array.from(byKey.entries()).map(([key, g]) => {
        const top = Array.from(g.variants.entries()).sort((a, b) => b[1] - a[1])[0][0];
        const name = official.get(key) || top;
        return { name, label: properCase(name), value: g.total, color: getCategoryColor(name), percentage: total > 0 ? (g.total / total) * 100 : 0 };
    });
    return { chartData: rows.sort((a, b) => b.value - a.value), totalSpent: total };
  }, [filteredReceipts, availableMasterCategories]);

  // Lojas: o mesmo apelido (ou o mesmo nome) vira uma barra só. `name` é a identidade usada no filtro;
  // `raw` é o nome do cupom que mais gastou, para quando a loja não tem apelido.
  const establishmentData = useMemo(() => {
    const agg = new Map<string, { value: number; alias: string | null; raws: Map<string, number> }>();
    filteredReceipts.forEach(r => {
        const key = keyOf(r.establishmentName, r.cnpj);
        let g = agg.get(key);
        if (!g) { g = { value: 0, alias: aliasOf(r.establishmentName, r.cnpj), raws: new Map() }; agg.set(key, g); }
        g.value += r.totalAmount;
        g.raws.set(r.establishmentName, (g.raws.get(r.establishmentName) || 0) + r.totalAmount);
    });
    return Array.from(agg.entries())
        .map(([name, g]) => ({ name, alias: g.alias, raw: Array.from(g.raws.entries()).sort((a, b) => b[1] - a[1])[0][0], value: g.value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 15); // Top 15 para manter a estética limpa
  }, [filteredReceipts, keyOf, aliasOf]);

  // Nome para mostrar de cada loja (por identidade), também para as lojas que o filtro escondeu
  const storeLabels = useMemo(() => {
    const m = new Map<string, string>();
    receipts.forEach(r => {
        const key = keyOf(r.establishmentName, r.cnpj);
        if (m.has(key)) return;
        const alias = aliasOf(r.establishmentName, r.cnpj);
        m.set(key, alias || (isUnidentifiedName(r.establishmentName) ? UNIDENTIFIED_LABEL : titleCase(cleanEstablishmentName(r.establishmentName))));
    });
    return m;
  }, [receipts, keyOf, aliasOf]);
  const storeLabel = (key: string) => storeLabels.get(key) || '';

  // Rótulos curtos dos gráficos: o apelido quando existe; senão a primeira palavra do nome, e mais palavras só quando dois nomes ficariam iguais.
  const establishmentLabels = useMemo(() => {
    // "Sem identificação" fica de fora: é uma etiqueta inteira, não um nome para encurtar.
    const known = establishmentData.filter(e => !e.alias && !isUnidentifiedName(e.raw));
    const shortened = shortLabels(known.map(k => cleanEstablishmentName(k.raw)));
    const short = new Map<string, string>(known.map((e, i) => [e.name, shortened[i]] as [string, string]));
    // sigla de 1 ou 2 letras ("SC", "AB") sozinha não diz qual é a loja: nesse caso vale o nome inteiro
    return establishmentData.map(e => {
        if (e.alias) return clip(e.alias, 24);
        if (isUnidentifiedName(e.raw)) return UNIDENTIFIED_LABEL;
        const s = short.get(e.name) || '';
        return clip(titleCase(s.replace(/[^A-Za-zÀ-ú0-9]/g, '').length <= 2 ? cleanEstablishmentName(e.raw) : s), 18);
    });
  }, [establishmentData]);

  // Timeline: escala (dia, mês ou trimestre) e poucos rótulos no eixo, conforme o período e a largura da tela
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineWidth = useElementWidth(timelineRef);
  const plotWidth = Math.max(120, timelineWidth - TL_AXIS_Y_WIDTH - TIMELINE_MARGIN_RIGHT);
  const series = useMemo(() => buildEvolution(filteredReceipts, config, plotWidth), [filteredReceipts, config, plotWidth]);
  const evolutionData = series.points;
  const peakIdx = useMemo(() => {
      let best = -1;
      evolutionData.forEach((p, i) => { if (p.value > 0 && (best < 0 || p.value > evolutionData[best].value)) best = i; });
      return best;
  }, [evolutionData]);
  const lastIdx = evolutionData.length - 1;
  // Pontos pequenos e finos, vazados na cor do cartão. Poucos pontos (até 12): todos. Muitos (um mês, um ano): só o pico e o último.
  const renderTimelineDot = (props: any) => {
      const { cx, cy, index } = props;
      const key = `dot-${index}`;
      const emph = index === peakIdx || index === lastIdx;
      if ((!series.showAllDots && !emph) || cx == null || cy == null) return <g key={key} />;
      return <circle key={key} className="tl-dot" cx={cx} cy={cy} r={emph ? 3 : 2.25} stroke="#D4AF37" strokeWidth={1.25} />;
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000 pb-20">
      {deptSheetOpen && <DeptFilterSheet options={deptOptions} filter={deptFilter} onChange={setDeptFilter} onClose={() => setDeptSheetOpen(false)} z="z-[250]" />}
      <div className="flex flex-col gap-2 md:gap-3 mb-3 md:mb-10 sticky top-0 z-[40] bg-black/60 backdrop-blur-xl py-2 ls:py-2 md:py-4 -mx-4 px-4 md:-mx-6 md:px-6">
        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-1 md:p-1.5 flex flex-wrap md:flex-nowrap ls:flex-nowrap items-center gap-y-1 md:gap-4 ls:gap-2 overflow-hidden" data-testid="filter-bar" data-open={filtersOpen ? 'true' : 'false'}>
            <div className="order-1 flex-1 md:flex-none ls:flex-none min-w-0 flex items-center gap-1 pl-1 pr-1 py-0.5 md:py-0 ls:py-0 md:pl-3 md:pr-3 md:border-r ls:border-r border-white/10 md:shrink-0 ls:shrink-0">
                <button type="button" onClick={() => setDeptSheetOpen(true)} data-testid="dept-filter-btn" data-active={deptActive ? 'true' : 'false'}
                    aria-haspopup="dialog" aria-label={`Categorias: ${deptLabel}. Alterar`}
                    className="min-w-0 flex-1 md:flex-none md:max-w-[200px] ls:max-w-[150px] h-8 px-2 rounded-xl flex items-center gap-2 text-left hover:bg-white/5 transition-colors">
                    <Filter className="w-4 h-4 text-luxury-gold shrink-0" />
                    <span data-testid="dept-filter-label" className={`truncate text-xs font-bold uppercase tracking-[0.04em] md:tracking-[0.08em] ls:tracking-[0.08em] ${deptActive ? 'dept-active text-luxury-gold' : 'text-zinc-300'}`}>{deptLabel}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                </button>
                {deptActive && (
                    <button type="button" onClick={() => setDeptFilter(invertDeptFilter(deptFilter))} data-testid="dept-invert"
                        title={deptFilter.mode === 'exclude' ? 'Inverter: ver só o que está tirado' : 'Inverter: voltar a tirar o que está marcado'}
                        aria-label="Inverter o filtro de categorias"
                        className="filter-chip shrink-0 w-8 h-8 flex items-center justify-center rounded-xl border bg-luxury-gold/10 text-luxury-gold border-luxury-gold/25 active:bg-luxury-gold/20">
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* Celular em pé: o período fechado vira um botão; ao tocar abre ano, meses, 7 dias e período */}
            <div className="order-1 flex md:hidden ls:hidden shrink-0 items-center gap-1 pr-1">
                {!filtersOpen && hasFilters && (
                    <button type="button" onClick={resetFilters} title="Limpar filtros" aria-label="Limpar filtros" data-testid="filter-reset-collapsed"
                        className="w-8 h-8 flex items-center justify-center rounded-xl border border-white/5 text-zinc-500 active:text-luxury-gold">
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                )}
                <button type="button" onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen} data-testid="filter-toggle"
                    className={`h-8 pl-2.5 pr-2 rounded-xl flex items-center gap-1.5 text-xs font-bold border transition-colors ${filtersOpen ? 'bg-luxury-gold text-black border-luxury-gold' : 'filter-chip bg-luxury-gold/10 text-luxury-gold border-luxury-gold/25'}`}>
                    <CalendarDays className="w-3.5 h-3.5" />
                    <span className="whitespace-nowrap" data-testid="filter-summary">{shortPeriod(config)}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${filtersOpen ? 'rotate-180' : ''}`} />
                </button>
            </div>
            {/* Aberta, a categoria e o botão do período ficam sozinhos na primeira linha */}
            {filtersOpen && <div className="order-1 w-full h-0 md:hidden ls:hidden" aria-hidden="true" />}

            {config.quickFilter === 'custom' ? (
                <div className={`order-4 md:order-3 ls:order-3 w-full md:w-auto ls:w-auto md:flex-1 ls:flex-1 ${moreCls} items-center gap-1.5 px-2 md:px-4 animate-in slide-in-from-left-2`}>
                    <PeriodPicker
                        start={config.customStartDate}
                        end={config.customEndDate}
                        onChange={(from, to) => onConfigChange({ ...config, customStartDate: from, customEndDate: to })}
                        placeholder="Escolher período"
                        size="compact"
                        className="flex-1"
                        openOnMount={!config.customStartDate && !config.customEndDate}
                    />
                </div>
            ) : (
                <>
                    <div className={`order-2 flex-1 md:flex-none ls:flex-none ${moreCls} items-center gap-2 px-3 md:px-5 md:border-r ls:border-r border-white/10 shrink-0`}>
                        <CalendarDays className="w-4 h-4 text-zinc-500" />
                        <select 
                            value={config.year} 
                            onChange={(e) => onConfigChange({ ...config, year: Number(e.target.value) })} 
                            className="bg-transparent text-xs font-bold text-zinc-300 focus:outline-none cursor-pointer uppercase tracking-[0.08em]"
                        >
                            {[2024, 2025, 2026].map(y => <option key={y} value={y} className="bg-black text-white">{y}</option>)}
                        </select>
                    </div>
                    <div className={`order-4 md:order-3 ls:order-3 w-full md:w-auto ls:w-auto md:flex-1 ls:flex-1 min-w-0 ${moreCls} items-center justify-start md:justify-between gap-0.5 md:gap-1 px-1 md:px-4 overflow-x-auto no-scrollbar`} data-testid="filter-months">
                        <button
                            onClick={() => onConfigChange({ ...config, month: null, quickFilter: null })}
                            className={`px-3 py-1.5 md:px-4 md:py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${config.month === null && !config.quickFilter ? 'bg-luxury-gold text-black shadow-lg shadow-luxury-gold/20' : 'text-zinc-500 hover:text-white'}`}
                        >
                            ANUAL
                        </button>
                        {MONTHS_SHORT.map((m, idx) => (
                            <button key={m} onClick={() => onConfigChange({ ...config, month: idx, quickFilter: null })} className={`px-2.5 py-1.5 md:px-3 md:py-2 rounded-full text-xs font-bold transition-all ${config.month === idx ? 'bg-luxury-gold/15 text-luxury-gold' : 'text-zinc-500 hover:text-zinc-300'}`}>
                                {m}
                            </button>
                        ))}
                    </div>
                </>
            )}

            <div className={`order-3 md:order-4 ls:order-4 ${moreCls} items-center gap-1.5 md:gap-2 px-2 md:px-4 md:border-l ls:border-l border-white/10 shrink-0`}>
                <button onClick={() => onConfigChange({ ...config, quickFilter: config.quickFilter === '7d' ? null : '7d', month: null })} className={`px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-xs font-bold border transition-all ${config.quickFilter === '7d' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'border-white/5 text-zinc-500'}`}>7 DIAS</button>
                <button onClick={() => onConfigChange({ ...config, quickFilter: config.quickFilter === 'custom' ? null : 'custom', month: null })} className={`px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 ${config.quickFilter === 'custom' ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/5 text-zinc-500'}`}><Calendar className="w-3.5 h-3.5" /> <span className="hidden sm:inline">PERÍODO</span></button>
                {hasFilters && (
                    <button
                        onClick={resetFilters}
                        title="Limpar filtros"
                        className="p-1.5 md:p-2 rounded-xl border border-white/5 text-zinc-600 hover:text-luxury-gold hover:border-luxury-gold/30 transition-all"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
        </div>

        {/* Item escolhido na busca: também fica sempre visível e com saída óbvia */}
        {config.item && itemSummary && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-luxury-gold/30 bg-luxury-gold/10 pl-4 pr-2 py-2" data-testid="item-filter-banner">
                <span className="text-[13px] text-zinc-200 min-w-0">
                    <span className="block truncate">Mostrando só <b className="font-semibold text-luxury-gold">{itemFilterTitle(config.item)}</b></span>
                    <span className="block text-xs text-zinc-400 tabular-nums truncate" data-testid="item-filter-summary">
                        {itemSummary.lines === 0 ? 'Nenhuma compra neste período' : `${itemSummary.lines} ${itemSummary.lines === 1 ? 'compra' : 'compras'} · ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(itemSummary.total)}`}
                    </span>
                </span>
                <button
                    onClick={() => onConfigChange({ ...config, item: null })}
                    data-testid="item-filter-clear"
                    className="shrink-0 px-3.5 py-1.5 rounded-full border border-luxury-gold/40 text-xs font-bold text-luxury-gold hover:bg-luxury-gold/15 transition-all"
                >
                    Ver tudo
                </button>
            </div>
        )}

        {/* Filtro de estabelecimento ligado ao tocar numa barra: fica sempre visível e com saída óbvia */}
        {config.establishment && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-luxury-gold/30 bg-luxury-gold/10 pl-4 pr-2 py-2" data-testid="est-filter-banner">
                <span className="text-[13px] text-zinc-200 min-w-0 truncate">
                    Mostrando só <b className="font-semibold text-luxury-gold">{storeLabel(config.establishment)}</b>
                </span>
                <button
                    onClick={() => onConfigChange({ ...config, establishment: null })}
                    className="shrink-0 px-3.5 py-1.5 rounded-full border border-luxury-gold/40 text-xs font-bold text-luxury-gold hover:bg-luxury-gold/15 transition-all"
                >
                    Ver tudo
                </button>
            </div>
        )}
      </div>

      <div className="relative z-30 mb-3 md:mb-8">
          <ItemSearchBox
              receipts={receipts}
              masters={masterProducts}
              selected={config.item || null}
              onSelect={(f) => onConfigChange({ ...config, item: f })}
              placeholder="Buscar item (ex.: cebola, leite, arroz)"
              testId="item-search"
          />
      </div>

      {/* No celular esses atalhos já estão na barra de abas do rodapé */}
      <div className="hidden md:grid grid-cols-4 gap-4 mb-10">
          <ActionButton onClick={onScanClick} icon={ScanLine} label="Escanear" primary />
          <ActionButton onClick={onHistoryClick} icon={History} label="Histórico" />
          <ActionButton onClick={onReportsClick} icon={BarChart3} label="Relatórios" />
          <ActionButton onClick={onSettingsClick} icon={Settings} label="Estúdio" />
      </div>

      <div className="mb-10 bg-black border border-white/10 rounded-[1.75rem] md:rounded-[2.5rem] p-4 md:p-10 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-96 h-96 bg-luxury-gold/5 blur-[120px] rounded-full pointer-events-none group-hover:bg-luxury-gold/10 transition-all duration-1000" />
          <div className="flex justify-between items-center mb-2 md:mb-8 relative z-10 px-1 md:px-0">
              <div className="flex flex-col">
                  <h3 className="text-[10px] text-zinc-500 uppercase tracking-[0.1em] font-bold mb-0.5 flex items-center gap-1.5">
                      <LineChart className="w-3 h-3 text-luxury-gold" /> Evolução de Gastos
                  </h3>
                  <span className="text-lg md:text-2xl font-serif text-white tracking-tight leading-tight">Timeline do Estúdio</span>
                  <span className="text-[11px] md:text-xs text-zinc-500 mt-0.5" data-testid="timeline-caption">{series.caption}</span>
              </div>
          </div>
          <div ref={timelineRef} className="tl-chart h-[176px] md:h-[280px] w-full relative z-10" data-testid="timeline-chart">
              <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={evolutionData} margin={{ top: 10, right: TIMELINE_MARGIN_RIGHT, left: 0, bottom: 2 }}>
                      <defs>
                          <linearGradient id="colorDashboard" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.2}/><stop offset="100%" stopColor="#D4AF37" stopOpacity={0}/>
                          </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="2 6" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} ticks={series.ticks} interval={0} tick={renderTimelineTick} height={24} />
                      <YAxis axisLine={false} tickLine={false} width={TL_AXIS_Y_WIDTH} tick={renderTimelineYTick} tickCount={4} />
                      <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(212,175,55,0.3)', strokeWidth: 1, strokeDasharray: '3 4' }} />
                      <Area type="monotone" dataKey="value" stroke="#D4AF37" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fillOpacity={1} fill="url(#colorDashboard)" animationDuration={900} dot={renderTimelineDot} activeDot={{ r: 3.5, stroke: '#D4AF37', strokeWidth: 1.5, className: 'tl-dot' }} />
                  </AreaChart>
              </ResponsiveContainer>
          </div>
      </div>

      {config.item && (
          <div className="mb-10" data-testid="item-price-section">
              <ItemPriceInsight items={itemHistory} title={itemFilterTitle(config.item)} periodTitle={periodLabel(config)} />
          </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 mb-10">
          <div className="lg:col-span-6 bg-zinc-950 border border-white/5 rounded-[2rem] md:rounded-[2.5rem] p-5 md:p-10 min-h-[420px] md:min-h-[500px] shadow-2xl relative overflow-hidden flex flex-col items-center justify-center">
               <div className="absolute top-5 left-5 md:top-10 md:left-10 flex flex-col">
                   <h3 className="text-[13px] text-zinc-200 font-semibold tracking-tight">Gastos por Departamento</h3>
               </div>
               <div className="h-[340px] md:h-[400px] w-[calc(100%+1.5rem)] md:w-full relative mt-10 md:mt-0">
                   <InteractiveDonut
                       data={chartData}
                       centerLabel={deptActive ? 'Total filtrado' : 'Total Investido'}
                       centerValue={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(totalSpent)}
                       onSliceClick={(entry) => onCategoryClick && onCategoryClick(entry.name)}
                   />
               </div>
          </div>
      <div className="lg:col-span-6 bg-black border border-white/10 rounded-[2rem] md:rounded-[2.5rem] p-5 md:p-8 shadow-2xl relative overflow-hidden group flex flex-col">
          <div className="absolute top-0 left-0 w-80 h-80 bg-blue-500/5 blur-[100px] rounded-full pointer-events-none group-hover:bg-blue-500/10 transition-all duration-1000" />
          <div className="flex justify-between items-center mb-6 relative z-10">
              <h3 className="text-[13px] text-zinc-200 font-semibold tracking-tight">Estabelecimento</h3>
              {config.establishment && (
                  <button
                    onClick={() => onConfigChange({ ...config, establishment: null })}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold text-[11px] font-bold uppercase tracking-wide hover:bg-luxury-gold/20 transition-all"
                  >
                      {clip(storeLabel(config.establishment), 22)} <span className="opacity-60">✕</span>
                  </button>
              )}
          </div>
          
          <div className="h-[230px] md:h-[350px] w-full relative z-10">
              <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                      data={establishmentData.slice(0, 8)}
                      layout="vertical"
                      margin={{ top: 0, right: 64, left: 0, bottom: 0 }}
                      barCategoryGap={6}
                  >
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" hide width={0} />
                      <Bar
                          dataKey="value"
                          radius={[6, 6, 6, 6]}
                          animationDuration={1200}
                          barSize={22}
                          onMouseEnter={(_, index) => setHoveredEstIdx(index)}
                          onMouseLeave={() => setHoveredEstIdx(null)}
                          onClick={(data: any) => data && onConfigChange({ ...config, establishment: config.establishment === data.name ? null : data.name })}
                          className="cursor-pointer"
                      >
                          {establishmentData.slice(0, 8).map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={!entry.alias && isUnidentifiedName(entry.raw) ? '#71717a' : CHART_COLORS[index % CHART_COLORS.length]} className="cursor-pointer transition-all" style={{ filter: hoveredEstIdx === index ? 'brightness(1.15)' : undefined }} />
                          ))}
                          <LabelList
                              dataKey="value"
                              content={({ x, y, width, height, value, index }: any) => {
                                  const name = establishmentLabels[index] ?? '';
                                  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(value));
                                  const bx = Number(x), bw = Number(width), cy = Number(y) + Number(height) / 2;
                                  const fits = bw >= name.length * 7 + 22;
                                  return (
                                      <g className="pointer-events-none">
                                          {fits ? (
                                              <>
                                                  <text x={bx + 10} y={cy} dy={4} fill="#0a0a0a" fontSize={12} fontWeight={700}>{name}</text>
                                                  <text x={bx + bw + 8} y={cy} dy={4} fill="#d4d4d8" fontSize={12} fontWeight={600}>{money}</text>
                                              </>
                                          ) : (
                                              <text x={bx + bw + 8} y={cy} dy={4} fontSize={12}>
                                                  <tspan fill="#e4e4e7" fontWeight={700}>{name}</tspan>
                                                  <tspan fill="#a1a1aa" fontWeight={600} dx={6}>{money}</tspan>
                                              </text>
                                          )}
                                      </g>
                                  );
                              }}
                          />
                      </Bar>
                  </BarChart>
              </ResponsiveContainer>
          </div>
          
      </div>
      </div>

          <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-3 mb-10">
              <h3 className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 font-bold px-1 mb-1 md:col-span-2">Departamentos</h3>
              {chartData.map((cat, idx) => {
                  const Icon = getCategoryIcon(cat.name);
                  return (
                      <div
                        key={idx}
                        role="button"
                        tabIndex={0}
                        data-testid="dept-card"
                        data-dept={cat.name}
                        aria-label={`Abrir ${cat.label}`}
                        onClick={() => onCategoryClick && onCategoryClick(cat.name)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCategoryClick && onCategoryClick(cat.name); } }}
                        className="flex items-center justify-between p-2.5 md:p-5 bg-white/[0.01] border border-white/5 rounded-2xl hover:bg-white/[0.04] hover:border-luxury-gold/20 active:bg-white/[0.06] transition-all group relative overflow-hidden cursor-pointer focus:outline-none focus-visible:border-luxury-gold/50"
                      >
                          <div className="flex items-center gap-3 md:gap-4 z-10 min-w-0">
                              <PercentRing percent={cat.percentage} color={cat.color} size={40}>
                                  <div
                                    className="w-7 h-7 rounded-lg bg-black border border-white/10 flex items-center justify-center transition-all"
                                    style={{ borderColor: `${cat.color}33` }}
                                  >
                                      <Icon className="w-3.5 h-3.5" style={{ color: cat.color }} />
                                  </div>
                              </PercentRing>
                              <div className="flex flex-col min-w-0">
                                  <span className="block text-[13px] font-semibold text-zinc-100 tracking-tight truncate" title={cat.label}>{cat.label}</span>
                                  <span className="text-xs text-zinc-400 font-medium tabular-nums mt-0.5">{cat.percentage.toFixed(1).replace('.', ',')}% do total</span>
                              </div>
                          </div>
                          <div className="flex items-center gap-1 z-10 shrink-0 pl-2">
                              <span className="text-sm md:text-base font-sans font-bold text-white tracking-tight">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(cat.value)}</span>
                              <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-luxury-gold transition-colors" aria-hidden="true" />
                          </div>
                      </div>
                  );
              })}
          </div>

      {/* NOVO: RELAÇÃO DE ESTABELECIMENTOS / RECIBOS */}
      <div className="animate-in slide-in-from-bottom-8 duration-700">
          <div className="flex items-center gap-3 mb-8 px-1">
              <History className="w-5 h-5 text-luxury-gold" />
              <h3 className="text-zinc-300 text-xs uppercase tracking-[0.08em] font-bold">Relação de Aquisições por Fluxo</h3>
          </div>
          <div className="space-y-2">
              {filteredReceipts.slice(0, 12).map((receipt) => (
                  <ReceiptRow key={receipt.id} receipt={receipt} onClick={openOriginal} />
              ))}
          </div>
          {filteredReceipts.length > 12 && (
              <button onClick={onHistoryClick} className="w-full mt-8 py-4 border border-dashed border-white/10 rounded-2xl text-[11px] font-bold text-zinc-500 uppercase tracking-[0.1em] hover:text-luxury-gold hover:border-luxury-gold/30 transition-all">
                  Ver todo o histórico auditado ({filteredReceipts.length} registros)
              </button>
          )}
      </div>
    </div>
  );
};

const ActionButton = ({ onClick, icon: Icon, label, primary }: any) => (
    <button onClick={onClick} className={`group flex flex-col items-center justify-center gap-4 p-5 sm:p-8 rounded-[2.5rem] border transition-all duration-500 shadow-xl ${primary ? 'bg-luxury-gold text-black border-luxury-gold shadow-luxury-gold/10' : 'bg-white/[0.02] border-white/10 text-zinc-500 hover:text-white hover:border-white/30'}`}>
        <div className={`p-4 rounded-2xl ${primary ? 'bg-black/10' : 'bg-white/5 group-hover:bg-white/10'}`}><Icon className="w-7 h-7" /></div>
        <span className="text-[11px] font-bold uppercase tracking-[0.1em]">{label}</span>
    </button>
);

export default Dashboard;
