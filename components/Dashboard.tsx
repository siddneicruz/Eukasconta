
import React, { useMemo, useState } from 'react';
import { Receipt, DashboardConfig, DEFAULT_CATEGORIES, TaxonomyNode } from '../types';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid, BarChart, Bar, LabelList } from 'recharts';
import InteractiveDonut from './InteractiveDonut';
import PercentRing from './PercentRing';
import ReceiptRow from './ReceiptRow';
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
    Lightbulb, Scroll, Flame, PartyPopper, Recycle, Vegan, Snowflake
} from 'lucide-react';
import * as LucideIcons from 'lucide-react';

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
}

const MONTHS_SHORT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const CHART_COLORS = ['#D4AF37', '#27A46D', '#3B82F6', '#EC4899', '#F59E0B', '#8B5CF6', '#10B981', '#EF4444', '#06B6D4', '#6366F1'];

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
const cleanEstablishmentLabel = (name: string, maxLen: number = 15): string => {
  const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let cleaned = stripAccents(name);
  GENERIC_ESTABLISHMENT_PHRASES.forEach(phrase => {
    cleaned = cleaned.replace(new RegExp(`\\b${phrase}\\b`, 'gi'), ' ');
  });
  cleaned = cleaned.replace(/\s+/g, ' ').trim() || name.trim();
  // Primeira palavra só — mais limpo que cortar no meio de uma palavra com "…".
  const firstWord = cleaned.split(' ')[0] || cleaned;
  return firstWord.length > maxLen ? `${firstWord.slice(0, maxLen - 1).trim()}…` : firstWord;
};

// Mesma ideia (primeira palavra), mas para nomes de categoria/departamento —
// sem a limpeza de termos genéricos de estabelecimento.
const firstWordLabel = (name: string, maxLen: number = 16): string => {
  const word = name.trim().split(' ')[0] || name;
  return word.length > maxLen ? `${word.slice(0, maxLen - 1).trim()}…` : word;
};

const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-zinc-950 border border-white/10 p-4 rounded-2xl shadow-2xl backdrop-blur-md">
                <p className="text-luxury-gold text-[10px] font-bold uppercase tracking-widest mb-2 border-b border-white/5 pb-2">{data.name || data.label}</p>
                <p className="text-white font-serif text-lg">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.value)}</p>
                {data.percentage && <p className="text-zinc-500 text-[9px] uppercase tracking-widest mt-1">{data.percentage.toFixed(1)}% do Capital</p>}
            </div>
        );
    }
    return null;
};

const Dashboard: React.FC<DashboardProps> = ({ receipts, taxonomy, config, onConfigChange, onCategoryClick, onScanClick, onHistoryClick, onReportsClick, onSettingsClick, onEditIcon, onSelectReceipt }) => {
  const [hoveredEstIdx, setHoveredEstIdx] = useState<number | null>(null);
  const availableMasterCategories = useMemo(() => {
      return taxonomy
        .filter(n => n.level === 1)
        .map(n => n.name)
        .sort();
  }, [taxonomy]);

  const filteredReceipts = useMemo(() => {
    return receipts.filter(r => {
        let rDate = new Date(r.date + 'T12:00:00');
        if (isNaN(rDate.getTime())) rDate = new Date();
        
        if (config.establishment && r.establishmentName !== config.establishment) return false;

        if (config.category) {
            const hasCategory = r.items.some(item => (item.category || '').startsWith(config.category!));
            if (!hasCategory) return false;
        }

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
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [receipts, config]);

  const { chartData, totalSpent } = useMemo(() => {
    const agg: Record<string, number> = {};
    let total = 0;
    filteredReceipts.forEach(receipt => {
        receipt.items.forEach(item => {
            const key = (item.category || 'Bazar e Outros').split(' - ')[0];
            const price = Number(item.totalPrice) || 0;
            if (config.category && key !== config.category) return;
            agg[key] = (agg[key] || 0) + price;
            total += price;
        });
    });
    return { 
        chartData: Object.entries(agg).map(([name, value]) => ({
            name, value, color: getCategoryColor(name), percentage: total > 0 ? (value / total) * 100 : 0
        })).sort((a, b) => b.value - a.value),
        totalSpent: total 
    };
  }, [filteredReceipts, config.category]);

  const establishmentData = useMemo(() => {
    const agg: Record<string, number> = {};
    filteredReceipts.forEach(r => {
        agg[r.establishmentName] = (agg[r.establishmentName] || 0) + r.totalAmount;
    });
    return Object.entries(agg)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 15); // Top 15 para manter a estética limpa
  }, [filteredReceipts]);

  const evolutionData = useMemo(() => {
      const agg: Record<string, number> = {};
      
      if (config.quickFilter === 'custom' && config.customStartDate && config.customEndDate) {
          const start = new Date(config.customStartDate + 'T12:00:00');
          const end = new Date(config.customEndDate + 'T12:00:00');
          const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
          const isMultiYear = start.getFullYear() !== end.getFullYear();

          if (diffMonths <= 1 && !isMultiYear) {
              // Range pequeno: Agrupa por dia
              filteredReceipts.forEach(r => {
                  const d = new Date(r.date + 'T12:00:00');
                  const day = d.getDate().toString().padStart(2, '0');
                  agg[day] = (agg[day] || 0) + r.totalAmount;
              });
              return Array.from({ length: 31 }, (_, i) => {
                  const day = (i + 1).toString().padStart(2, '0');
                  return { name: day, value: agg[day] || 0 };
              }).filter(d => d.value > 0 || Number(d.name) <= end.getDate());
          } else {
              // Range longo: Agrupa por mês (Máximo 24 meses)
              const dataPoints = [];
              const curr = new Date(start);
              curr.setDate(1);
              let safety = 0;
              while (curr <= end && safety < 24) {
                  const mKey = `${curr.getFullYear()}-${curr.getMonth()}`;
                  let mTotal = 0;
                  filteredReceipts.forEach(r => {
                      const rd = new Date(r.date + 'T12:00:00');
                      if (rd.getFullYear() === curr.getFullYear() && rd.getMonth() === curr.getMonth()) {
                          mTotal += r.totalAmount;
                      }
                  });
                  const label = isMultiYear 
                    ? `${MONTHS_SHORT[curr.getMonth()]} ${curr.getFullYear().toString().slice(-2)}`
                    : MONTHS_SHORT[curr.getMonth()];
                  
                  dataPoints.push({ name: label, value: mTotal });
                  curr.setMonth(curr.getMonth() + 1);
                  safety++;
              }
              return dataPoints;
          }
      }

      if (config.month !== null) {
          filteredReceipts.forEach(r => {
              const d = new Date(r.date + 'T12:00:00');
              const day = d.getDate().toString().padStart(2, '0');
              agg[day] = (agg[day] || 0) + r.totalAmount;
          });
          return Array.from({ length: 31 }, (_, i) => {
              const day = (i + 1).toString().padStart(2, '0');
              return { name: day, value: agg[day] || 0 };
          }).filter(d => d.value > 0 || Number(d.name) <= new Date().getDate());
      } else {
          filteredReceipts.forEach(r => {
              const d = new Date(r.date + 'T12:00:00');
              const month = MONTHS_SHORT[d.getMonth()];
              agg[month] = (agg[month] || 0) + r.totalAmount;
          });
          return MONTHS_SHORT.map(m => ({ name: m, value: agg[m] || 0 }));
      }
  }, [filteredReceipts, config]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000 pb-20">
      <div className="flex flex-col gap-3 mb-4 md:mb-10 sticky top-0 z-[40] bg-black/60 backdrop-blur-xl py-3 ls:py-2 md:py-4 -mx-4 px-4 md:-mx-6 md:px-6">
        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-1.5 flex flex-wrap md:flex-nowrap ls:flex-nowrap items-center gap-y-2 md:gap-4 ls:gap-2 overflow-hidden">
            <div className="order-1 w-full md:w-auto ls:w-auto min-w-0 flex items-center gap-2 px-3 pt-1 md:pt-0 ls:pt-0 md:px-5 md:border-r ls:border-r border-white/10 md:shrink-0 ls:shrink-0">
                <Filter className="w-4 h-4 text-luxury-gold" />
                <select 
                    value={config.category || ''} 
                    onChange={(e) => onConfigChange({ ...config, category: e.target.value || null })} 
                    className="bg-transparent text-xs font-bold text-zinc-300 focus:outline-none cursor-pointer uppercase tracking-widest w-full md:w-auto md:max-w-[150px] ls:w-auto ls:max-w-[130px] truncate"
                >
                    <option value="" className="bg-black">TODAS CATEGORIAS</option>
                    {availableMasterCategories.map(cat => <option key={cat} value={cat} className="bg-black text-white">{cat}</option>)}
                </select>
            </div>
            
            {config.quickFilter === 'custom' ? (
                <div className="order-4 md:order-3 ls:order-3 w-full md:w-auto ls:w-auto md:flex-1 ls:flex-1 flex items-center gap-1.5 px-2 md:px-4 animate-in slide-in-from-left-2">
                    <div className="relative flex-1 min-w-0">
                        <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600 pointer-events-none" />
                        <input type="date" value={config.customStartDate} onChange={e => onConfigChange({...config, customStartDate: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg py-1.5 pl-6 pr-1 text-[9px] text-zinc-300 outline-none focus:border-luxury-gold/40" />
                    </div>
                    <span className="text-zinc-700 font-bold text-xs shrink-0">A</span>
                    <div className="relative flex-1 min-w-0">
                        <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600 pointer-events-none" />
                        <input type="date" value={config.customEndDate} onChange={e => onConfigChange({...config, customEndDate: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg py-1.5 pl-6 pr-1 text-[9px] text-zinc-300 outline-none focus:border-luxury-gold/40" />
                    </div>
                </div>
            ) : (
                <>
                    <div className="order-2 flex-1 md:flex-none ls:flex-none flex items-center gap-2 px-3 md:px-5 md:border-r ls:border-r border-white/10 shrink-0">
                        <CalendarDays className="w-4 h-4 text-zinc-500" />
                        <select 
                            value={config.year} 
                            onChange={(e) => onConfigChange({ ...config, year: Number(e.target.value) })} 
                            className="bg-transparent text-xs font-bold text-zinc-300 focus:outline-none cursor-pointer uppercase tracking-widest"
                        >
                            {[2024, 2025, 2026].map(y => <option key={y} value={y} className="bg-black text-white">{y}</option>)}
                        </select>
                    </div>
                    <div className="order-4 md:order-3 ls:order-3 w-full md:w-auto ls:w-auto md:flex-1 ls:flex-1 min-w-0 flex items-center justify-start md:justify-between gap-1 px-2 md:px-4 overflow-x-auto no-scrollbar">
                        <button 
                            onClick={() => onConfigChange({ ...config, month: null, quickFilter: null })} 
                            className={`px-4 py-2 rounded-full text-[10px] font-bold transition-all whitespace-nowrap ${config.month === null && !config.quickFilter ? 'bg-luxury-gold text-black shadow-lg shadow-luxury-gold/20' : 'text-zinc-500 hover:text-white'}`}
                        >
                            ANUAL
                        </button>
                        {MONTHS_SHORT.map((m, idx) => (
                            <button key={m} onClick={() => onConfigChange({ ...config, month: idx, quickFilter: null })} className={`px-3 py-2 rounded-full text-[10px] font-bold transition-all ${config.month === idx ? 'bg-luxury-gold/15 text-luxury-gold' : 'text-zinc-600 hover:text-zinc-300'}`}>
                                {m}
                            </button>
                        ))}
                    </div>
                </>
            )}

            <div className="order-3 md:order-4 ls:order-4 flex items-center gap-2 px-2 md:px-4 md:border-l ls:border-l border-white/10 shrink-0">
                <button onClick={() => onConfigChange({ ...config, quickFilter: config.quickFilter === '7d' ? null : '7d', month: null })} className={`px-4 py-2 rounded-xl text-[9px] font-bold border transition-all ${config.quickFilter === '7d' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'border-white/5 text-zinc-600'}`}>7 DIAS</button>
                <button onClick={() => onConfigChange({ ...config, quickFilter: config.quickFilter === 'custom' ? null : 'custom', month: null })} className={`px-4 py-2 rounded-xl text-[9px] font-bold border transition-all flex items-center gap-2 ${config.quickFilter === 'custom' ? 'bg-luxury-gold text-black border-luxury-gold' : 'border-white/5 text-zinc-600'}`}><Calendar className="w-3.5 h-3.5" /> <span className="hidden sm:inline">PERÍODO</span></button>
                {(config.category || config.month !== null || config.quickFilter) && (
                    <button
                        onClick={() => onConfigChange({ year: new Date().getFullYear(), month: null, category: null, quickFilter: null, customStartDate: '', customEndDate: '', establishment: null })}
                        title="Limpar filtros"
                        className="p-2 rounded-xl border border-white/5 text-zinc-600 hover:text-luxury-gold hover:border-luxury-gold/30 transition-all"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
        </div>
      </div>

      {/* No celular esses atalhos já estão na barra de abas do rodapé */}
      <div className="hidden md:grid grid-cols-4 gap-4 mb-10">
          <ActionButton onClick={onScanClick} icon={ScanLine} label="Escanear" primary />
          <ActionButton onClick={onHistoryClick} icon={History} label="Histórico" />
          <ActionButton onClick={onReportsClick} icon={BarChart3} label="Relatórios" />
          <ActionButton onClick={onSettingsClick} icon={Settings} label="Estúdio" />
      </div>

      <div className="mb-10 bg-black border border-white/10 rounded-[2rem] md:rounded-[2.5rem] p-5 md:p-10 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-96 h-96 bg-luxury-gold/5 blur-[120px] rounded-full pointer-events-none group-hover:bg-luxury-gold/10 transition-all duration-1000" />
          <div className="flex justify-between items-center mb-4 md:mb-8 relative z-10">
              <div className="flex flex-col">
                  <h3 className="text-[10px] text-zinc-500 uppercase tracking-[0.4em] font-bold mb-1 flex items-center gap-2">
                      <LineChart className="w-3 h-3 text-luxury-gold" /> Evolução de Gastos
                  </h3>
                  <span className="text-2xl font-serif text-white tracking-tighter">Timeline do Estúdio</span>
              </div>
          </div>
          <div className="h-[170px] md:h-[280px] w-full relative z-10">
              <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={evolutionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                          <linearGradient id="colorDashboard" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.25}/><stop offset="95%" stopColor="#D4AF37" stopOpacity={0}/>
                          </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 10, fontWeight: 'bold' }} dy={15} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 10 }} tickFormatter={(val) => `R$${val}`} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="value" stroke="#D4AF37" strokeWidth={3} fillOpacity={1} fill="url(#colorDashboard)" animationDuration={2000} dot={{ r: 4, fill: '#000', stroke: '#D4AF37', strokeWidth: 2 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} />
                  </AreaChart>
              </ResponsiveContainer>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 mb-10">
          <div className="lg:col-span-6 bg-zinc-950 border border-white/5 rounded-[2rem] md:rounded-[2.5rem] p-5 md:p-10 min-h-[420px] md:min-h-[500px] shadow-2xl relative overflow-hidden flex flex-col items-center justify-center">
               <div className="absolute top-5 left-5 md:top-10 md:left-10 flex flex-col">
                   <h3 className="text-[13px] text-zinc-200 font-semibold tracking-tight">Gastos por Departamento</h3>
               </div>
               <div className="h-[340px] md:h-[400px] w-full relative mt-10 md:mt-0">
                   <InteractiveDonut
                       data={chartData}
                       innerRadius="58%"
                       outerRadius="78%"
                       centerLabel="Total Investido"
                       centerValue={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(totalSpent)}
                       tooltipContent={CustomTooltip}
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-luxury-gold/10 border border-luxury-gold/30 text-luxury-gold text-[9px] font-bold uppercase tracking-wide hover:bg-luxury-gold/20 transition-all"
                  >
                      {cleanEstablishmentLabel(config.establishment)} <span className="opacity-60">✕</span>
                  </button>
              )}
          </div>
          
          <div className="h-[230px] md:h-[350px] w-full relative z-10">
              <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                      data={establishmentData.slice(0, 8)}
                      layout="vertical"
                      margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                      barCategoryGap={6}
                  >
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" hide width={0} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
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
                              <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} className="cursor-pointer transition-all" style={{ filter: hoveredEstIdx === index ? 'brightness(1.15)' : undefined }} />
                          ))}
                          <LabelList
                              dataKey="name"
                              position="insideLeft"
                              content={({ x, y, width, height, value, index }: any) => (
                                  // Sobretom sutil (branco a 20% de opacidade) sobre a própria cor da
                                  // barra — quase invisível em repouso, e ganha destaque no hover.
                                  <text
                                      x={Number(x) + 10}
                                      y={Number(y) + Number(height) / 2}
                                      dy={4}
                                      fill="#fff"
                                      fillOpacity={hoveredEstIdx === index ? 0.95 : 0.2}
                                      fontSize={11}
                                      fontWeight={600}
                                      className="tracking-tight transition-opacity duration-200 pointer-events-none"
                                  >
                                      {cleanEstablishmentLabel(String(value))}
                                  </text>
                              )}
                          />
                          <LabelList
                              dataKey="value"
                              position="right"
                              formatter={(v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)}
                              style={{ fill: '#a1a1aa', fontSize: 10, fontWeight: 700 }}
                          />
                      </Bar>
                  </BarChart>
              </ResponsiveContainer>
          </div>
          
      </div>
      </div>

          <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-3 mb-10">
              <h3 className="text-[10px] uppercase tracking-[0.4em] text-zinc-500 font-bold px-1 mb-1 md:col-span-2">Departamentos</h3>
              {chartData.map((cat, idx) => {
                  const Icon = getCategoryIcon(cat.name);
                  return (
                      <div key={idx} className="flex items-center justify-between p-2.5 md:p-5 bg-white/[0.01] border border-white/5 rounded-2xl hover:bg-white/[0.04] hover:border-luxury-gold/20 transition-all group relative overflow-hidden">
                          <div className="flex items-center gap-3 md:gap-4 z-10 min-w-0">
                              <PercentRing percent={cat.percentage} color={cat.color} size={40}>
                                  <div
                                    onClick={(e) => { e.stopPropagation(); onEditIcon && onEditIcon(cat.name); }}
                                    className="w-7 h-7 rounded-lg bg-black border border-white/10 flex items-center justify-center cursor-pointer hover:border-luxury-gold transition-all"
                                    style={{ borderColor: `${cat.color}33` }}
                                  >
                                      <Icon className="w-3.5 h-3.5" style={{ color: cat.color }} />
                                  </div>
                              </PercentRing>
                              <div className="flex flex-col cursor-pointer min-w-0" onClick={() => onCategoryClick && onCategoryClick(cat.name)}>
                                  <span className="block text-[13px] font-semibold text-zinc-100 tracking-tight truncate" title={cat.name}>{firstWordLabel(cat.name)}</span>
                                  <span className="text-[9px] text-zinc-600 font-mono font-bold uppercase tracking-widest mt-0.5">{cat.percentage.toFixed(1)}% do total</span>
                              </div>
                          </div>
                          <span className="text-sm md:text-base font-serif font-bold text-white tracking-tight z-10 shrink-0 pl-2">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(cat.value)}</span>
                      </div>
                  );
              })}
          </div>

      {/* NOVO: RELAÇÃO DE ESTABELECIMENTOS / RECIBOS */}
      <div className="animate-in slide-in-from-bottom-8 duration-700">
          <div className="flex items-center gap-3 mb-8 px-1">
              <History className="w-5 h-5 text-luxury-gold" />
              <h3 className="text-zinc-300 text-xs uppercase tracking-widest font-bold">Relação de Aquisições por Fluxo</h3>
          </div>
          <div className="space-y-2">
              {filteredReceipts.slice(0, 12).map((receipt) => (
                  <ReceiptRow key={receipt.id} receipt={receipt} onClick={onSelectReceipt} />
              ))}
          </div>
          {filteredReceipts.length > 12 && (
              <button onClick={onHistoryClick} className="w-full mt-8 py-4 border border-dashed border-white/10 rounded-2xl text-[10px] font-bold text-zinc-600 uppercase tracking-[0.3em] hover:text-luxury-gold hover:border-luxury-gold/30 transition-all">
                  Ver todo o histórico auditado ({filteredReceipts.length} registros)
              </button>
          )}
      </div>
    </div>
  );
};

const ActionButton = ({ onClick, icon: Icon, label, primary }: any) => (
    <button onClick={onClick} className={`group flex flex-col items-center justify-center gap-4 p-8 rounded-[2.5rem] border transition-all duration-500 shadow-xl ${primary ? 'bg-luxury-gold text-black border-luxury-gold shadow-luxury-gold/10' : 'bg-white/[0.02] border-white/10 text-zinc-500 hover:text-white hover:border-white/30'}`}>
        <div className={`p-4 rounded-2xl ${primary ? 'bg-black/10' : 'bg-white/5 group-hover:bg-white/10'}`}><Icon className="w-7 h-7" /></div>
        <span className="text-[11px] font-bold uppercase tracking-[0.4em]">{label}</span>
    </button>
);

export default Dashboard;
