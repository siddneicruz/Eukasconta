/* Equivalência entre o Mapa de Categorias do Extra Mercado e a Estrutura de Taxonomia do app (4 camadas).
   Cada nome do Extra aponta para um nó que já existe na Estrutura, em qualquer camada (departamento › categoria › grupo › item).
   Nunca cria camada nova: o que não tem lugar fica "A decidir", e as linhas de produto do Extra (Caras do Brasil…) viram marca.

   Formato do texto abaixo:
     ## caminho padrão      → vale para as linhas seguintes que não trazem destino próprio
     Nome                   → usa o caminho padrão
     Nome|Outro > caminho   → destino próprio (o "~" no começo repete o departamento do caminho padrão)
     Nome > ?               → sem equivalente: vai para a fila "A decidir"
     Nome > #marca          → linha de produto/marca do Extra, não é categoria
     Nome > #agrupador      → agrupador do próprio Extra, sem nó equivalente
   Siglas de departamento: AÇ açougue, BZ bazar, BB bebidas, CG congelados, CP cuidados pessoais, HF hortifruti, LF laticínios,
   LC limpeza, MB mercearia básica, MD mercearia doce, MS mercearia salgada, MI mundo infantil, PD padaria, PT pet shop,
   PL plantas, RT rotisseria, SE saudáveis, VS vestuário. */

export interface ExtraEquivalent {
  /** nome da categoria no Extra Mercado */
  extra: string;
  /** caminho na Estrutura (departamento, categoria, grupo, item); vazio quando não tem equivalente */
  path: string[];
  kind: 'nó' | 'a decidir' | 'marca' | 'agrupador';
}

const DEPTS: Record<string, string> = {
  'AÇ': 'AÇOUGUE E PEIXARIA', BZ: 'Bazar e Utilidades Domésticas', BB: 'BEBIDAS', CG: 'Congelados', CP: 'CUIDADOS PESSOAIS',
  HF: 'HORTIFRUTI', LF: 'LATICÍNIOS E FRIOS', LC: 'LIMPEZA E CASA', MB: 'Mercearia Básica', MD: 'Mercearia Doce e Matinais',
  MS: 'Mercearia Salgada e Conservas', MI: 'Mundo Infantil', PD: 'Padaria e Confeitaria', PT: 'Pet Shop', PL: 'PLANTAS ORNAMENTAIS',
  RT: 'Rotisseria e Comida Pronta', SE: 'Saudáveis e Especiais', VS: 'VESTUÁRIO',
};

export const EXTRA_MAP_TEXT = `
Alimentos > #agrupador

## AÇ
Açougue|Carnes
Carne - Plant Based > SE > Vegano e Vegetariano > Proteínas Vegetais
Carne - Temperos > AÇ > Carne Bovina > Cortes para Preparo
Carne Bovina > AÇ > Carne Bovina
Carne Aves > AÇ > Aves
Carne Suína > AÇ > Carne Suína
Carnes Exóticas e Especiais > AÇ > Cordeiro, Caprinos e Exóticos

## CG
Alimentos Congelados
Pratos Congelados|Lanches Congelados|Sopas Congeladas|Tortas Congeladas|Pratos Prontos Congelados > CG > Pratos Prontos Congelados
Carnes, Aves e Peixes > CG > Empanados e Processados
Massas Congeladas > CG > Massas e Pães Congelados > Massas Congeladas
Legumes e Vegetais Congelados > CG > Vegetais e Frutas Congelados > Vegetais Congelados
Sobremesas Congeladas|Açaí|Sobremesas Diversas > CG > Sorvetes e Sobremesas Geladas > Sobremesas Congeladas
Sorvetes > CG > Sorvetes e Sobremesas Geladas > Sorvetes
Sazonal Industrializado > ?
Sazonal Industrializado - Suínos > AÇ > Carne Suína
Sazonal Industrializado - Aves > AÇ > Aves

## LF
Alimentos Refrigerados
Frios e Embutidos|Cortes Especiais > LF > Frios e Embutidos
Linguiças > AÇ > Linguiças e Embutidos Frescos > Linguiças
Mortadela > LF > Frios e Embutidos > Mortadelas e Blanquet
Presunto > LF > Frios e Embutidos > Presuntos
Salames > LF > Frios e Embutidos > Salames e Curados
Salsichas > LF > Frios e Embutidos > Salsichas
Salgados e Defumados > LF > Frios e Embutidos > Linguiças Defumadas
Frutas, Legumes e Verduras > HF > Minimamente Processados
Legumes Refrigerados > HF > Minimamente Processados > Legumes Cortados
Verduras Refrigeradas > HF > Minimamente Processados > Saladas Prontas
Frutas Refrigeradas > HF > Minimamente Processados > Frutas Cortadas
Caldos e Temperos > MS > Temperos e Especiarias > Temperos Prontos
Iogurtes|Iogurte Funcional|Iogurte Liquido|Iogurte Natural|Iogurte Polpa|Iogurte Grego|Iogurtes Diferenciados > LF > Iogurtes e Sobremesas Lácteas > Iogurtes
Iogurte para Sobremesa|Iogurte Petit Suisse > LF > Iogurtes e Sobremesas Lácteas > Sobremesas Lácteas
Leite Fermentado > LF > Leites e Bebidas Lácteas Refrigeradas > Bebidas Lácteas
Laticínios > LF
Chantilly|Creme de Leite Refrigerado|Nata > LF > Manteigas, Margarinas e Cremes > Cremes e Natas
Fondue|Queijo Cremoso > LF > Queijos > Queijos Frescos
Leites Frescos > LF > Leites e Bebidas Lácteas Refrigeradas > Leite Refrigerado
Margarinas, Manteigas e Gorduras > LF > Manteigas, Margarinas e Cremes
Massas Refrigeradas > LF > Massas Frescas e Refrigerados Prontos > Massas Frescas
Pratos Prontos Refrigerados > LF > Massas Frescas e Refrigerados Prontos > Pratos Refrigerados
Queijos > LF > Queijos
Patês e Antepastos > LF > Antepastos e Conservas Refrigeradas
Ovos Refrigerados|Ovos Líquido > HF > Ovos > Ovos de Galinha

## MD
Básico da Despensa > MB
Achocolatados|Achocolatado Diet ou Light|Achocolatado Saborizado|Achocolatado Em Pó|Achocolatado Maltado|Achocolatado à Base de Soja|Achocolatado Líquido > MD > Achocolatados e Bebidas em Pó > Achocolatados
Açúcar|Açúcar Cristal|Açúcar Orgânico|Açúcar para Confeitaria|Açúcar em Cubo|Açúcar Demerara|Açúcar Mascavo|Açúcar em Sachê|Açúcar Refinado > MB > Açúcares e Adoçantes > Açúcares
Cafés > MD > Café
Café em Cápsula > MD > Café > Café em Cápsula
Café em Grão > MD > Café > Café em Grão
Café Solúvel > MD > Café > Café Solúvel e Preparos
Café Torrado e Moído > MD > Café > Café Torrado e Moído
Cestas > BZ > Sazonais e Festas
Cesta Básica > ?
Cesta de Natal > BZ > Sazonais e Festas > Datas Comemorativas
Farináceos > MB > Farinhas e Amidos
Farinha|Trigo > MB > Farinhas e Amidos > Farinhas de Trigo
Mistura > MB > Farinhas e Amidos > Farinhas Especiais
Fubá|Cuzcuz|Farofa Pronta > MB > Farinhas e Amidos > Farinhas de Mandioca e Milho
Farinha De Rosca > MB > Farinhas e Amidos > Farinhas Especiais
Purê de Batata > MS > Pratos Prontos e Sopas > Kits de Preparo
Grãos e Cereais|Canjica|Canjiquinha|Pipoca > MB > Grãos, Cereais e Sementes > Grãos
Polvilho|Sagu|Tapióca > MB > Farinhas e Amidos > Amidos e Féculas
Amendoim > MS > Snacks e Aperitivos > Castanhas e Nuts
Arroz > MB > Arroz
Evilha|Grão de Bico|Grãos Secos|Lentilha|Soja > MB > Feijões e Leguminosas > Outras Leguminosas
Feijão > MB > Feijões e Leguminosas > Feijões
Leite em Pó|Leite em Pó de Soja|Leite em Pó Desnatado|Leite em Pó Integral|Leite em Pó Modificado|Leite em Pó Sachês > MD > Leite Longa Vida e em Pó > Leite em Pó
Leites|Leite Desnatado|Leite Integral|Leite Semi-desnatado|Leites Especiais > MD > Leite Longa Vida e em Pó > Leite UHT
Leite Zero Lactose > SE > Sem Glúten e Sem Lactose > Zero Lactose
Leite Vegetal > MD > Leite Longa Vida e em Pó > Bebidas Vegetais
Massas > MB > Massas Secas
Massa Instantânea > MB > Massas Secas > Macarrão Instantâneo
Massas Secas > MB > Massas Secas
Massas Sem Glúten > SE > Sem Glúten e Sem Lactose > Sem Glúten
Óleos e Azeites > MB > Óleos, Azeites e Gorduras
Azeite > MB > Óleos, Azeites e Gorduras > Azeites
Óleo Misto|Óleos|Óleo Composto > MB > Óleos, Azeites e Gorduras > Óleos Vegetais
Cereais|Cereais Matinais|Cereais Naturais|Cereais Sabores|Cereais Funcionais > MD > Cereais Matinais
Aveia|Aveia em Floco|Farinha de Aveia|Aveia Saborizada|Granola e Mix de Cereais > MD > Cereais Matinais > Cereais e Granolas

## SE
Complemento da Despensa > MS
Saudáveis|Saudáveis e Funcionais > SE
Farináceos Saudáveis > MB > Farinhas e Amidos > Farinhas Especiais
Snacks > MS > Snacks e Aperitivos
Grãos e Sementes > MB > Grãos, Cereais e Sementes > Sementes
Suplementos Alimentares > SE > Suplementos e Nutrição Esportiva > Suplementos
Nutrição|Alimentar Adulto|Emagrecedor|Alimentar e Energético > SE > Suplementos e Nutrição Esportiva
Purê de Frutas > ?

## MD
Biscoitos > MD > Biscoitos
Biscoitos Doces > MD > Biscoitos > Biscoitos Doces
Biscoitos Salgados > MD > Biscoitos > Biscoitos Salgados
Sazonal de Mercearia|Colombas|Ovo de Páscoa|Panetone e Chocotones|Presenteáveis > PD > Sazonais de Padaria > Natal e Páscoa
Adoçantes|Adoçantes Líquido|Adoçantes em Pó|Adoçantes Culinário|Xilitol|Sucralose|Eritritol > MB > Açúcares e Adoçantes > Adoçantes
Chá|Chá Misto|Chá Mate|Chá Preto > MD > Chás e Infusões
Doces e Sobremesas > MD > Doces e Sobremesas
Confeitaria > MD > Confeitaria Caseira
Leite Condensado|Creme de Leite > MD > Confeitaria Caseira > Leites e Cremes para Doces
Amido de Milho > MB > Farinhas e Amidos > Amidos e Féculas
Confeitos e Granulados > MD > Confeitaria Caseira > Decoração e Coberturas
Derivados de Coco|Fermento|Mistura para Bolos > MD > Confeitaria Caseira > Ingredientes para Bolo
Gelatina|Sobremesas > MD > Doces e Sobremesas > Sobremesas para Preparo
Doces|Doces em Calda|Doces em Massas|Doces em Pasta > MD > Doces e Sobremesas > Doces Tradicionais
Bomboniere|Chocolates|Bombons > MD > Doces e Sobremesas > Chocolates
Balas e Doces > MD > Doces e Sobremesas > Balas, Gomas e Pirulitos
Acompanhamentos > ?
Geléias > MD > Geleias e Pastas > Geleias e Cremes
Mel e Derivados > MB > Açúcares e Adoçantes > Mel e Melados

## HF
Hortifruti
Frutas > HF > Frutas
Frutas Secas > MS > Snacks e Aperitivos > Frutas Secas e Desidratadas
Frutas Especiais > HF > Frutas > Frutas Exóticas e Regionais
Frutas Fracionadas > HF > Minimamente Processados > Frutas Cortadas
Maçã|Pêras > HF > Frutas > Frutas - Pomáceas
Mamão|Frutas Tropicais|Banana > HF > Frutas > Frutas - Tropicais
Melão e Melância > HF > Frutas > Melões e Melancias
Uvas > HF > Frutas > Frutas de Clima Temperado
Frutas Orgânicas|Orgânicos > HF > Orgânicos
Frutas Cítricas > HF > Frutas > Frutas - Citros
Legumes e Verduras
Hidropônicos|Hortaliças > HF > Verduras e Folhas > Folhas
Temperos > HF > Verduras e Folhas > Ervas Frescas
Cogumelos > HF > Cogumelos
Legumes > HF > Legumes
Ovos > HF > Ovos
Ovos Orgânicos|Ovos Brancos|Ovos Vermelhos|Ovos Caipira > HF > Ovos > Ovos de Galinha
Ovos Especiais > HF > Ovos > Outros Ovos

## MS
Mercearia Salgada
Molhos e Condimentos|Molhos > MS > Molhos
Especiarias > MS > Temperos e Especiarias > Especiarias Secas
Extrato de Tomate|Atomatados > MS > Molhos > Molhos de Tomate
Ketchup e Mostarda|Maionese > MS > Molhos > Condimentos
Sal|Vinagres > MB > Sal e Temperos Básicos
Alimentos em Conserva|Outros Alimentos em Conserva|Enlatados > MS > Conservas
Vegetais em Conserva > MS > Conservas > Conservas Vegetais
Étnicos|Árabe|Kosher|Mexicano|Oriental > MS > Molhos > Molhos Especiais
Peixes em Conserva|Atum|Sardinha|Outros Peixes em Conserva > MS > Conservas > Conservas de Pescado
Pratos Prontos|Prato Pronto - Feijão|Prato Pronto - Massas|Prato Pronto - Soja|Refeição Pronta|Prato Pronto - Arroz > MS > Pratos Prontos e Sopas > Refeições Instantâneas
Sopas e Cremes|Cremes|Sopas > MS > Pratos Prontos e Sopas

## PD
Padaria
Fabricação Própria Padaria|Acompanhamentos Padaria|Pães Fabricação Própria|Pães Orgânicos > PD > Pães de Produção Própria
Bolos e Doces|Bolos e Doces da Padaria > PD > Bolos e Tortas
Confeitaria Gelada > PD > Confeitaria
Insumos da Padaria > ?
Lanche > PD > Pães Industrializados > Pães para Lanche
Biscoitos Doces da Padaria|Biscoitos Salgados da Padaria > MD > Biscoitos
Torradas da Padaria > PD > Pães Industrializados > Torradas e Croutons
Padaria Industrializada|Pães > PD > Pães Industrializados
Ingredientes Culinários Padaria > MD > Confeitaria Caseira > Ingredientes para Bolo
Confeitaria Sazonal > PD > Sazonais de Padaria

## AÇ
Peixaria
Peixes Congelados|Pescados Congelados > AÇ > Peixes Congelados
Frutos do Mar Congelados|Frutos do Mar > AÇ > Frutos do Mar
Bacalhau Congelado|Bacalhau > AÇ > Bacalhau e Salgados > Bacalhau
Peixes Frescos > AÇ > Peixes Frescos
Insumos da Peixaria > ?
Pescados > AÇ > Pescados e Mar
Pratos Prontos da Peixaria > RT > Pratos Quentes
Peixes Salgados > AÇ > Bacalhau e Salgados > Pescados Secos e Defumados

## RT
Rotisserie
Entradas e Acompanhamentos|Acompanhamentos Rotisserie|Sopas e Cremes Rotisserie|Tortas e Quiches Rotisserie|Fabricação Própria|Prato Principal|Refeição Completa|Pratos Semi Prontos|Combinados Rotisserie|Lanchonete > RT > Pratos Quentes
Saladas Rotisserie > RT > Saladas e Sanduíches Prontos > Saladas
Doces Rotisserie|Doces da Lanchonete|Sobremesas da Lanchonete > PD > Confeitaria > Doces Finos
Insumos da Rotisserie|Serviços Diferenciados|Central de Produção|Insumos da Lanchonete > ?
Bebidas Rotisserie > BB
Salgados da Lanchonete > PD > Confeitaria > Salgados Assados e Fritos
Sanduíches da Lanchonete > RT > Saladas e Sanduíches Prontos > Sanduíches

## MS
Salgadinhos e Aperitivos > MS > Snacks e Aperitivos
Aperitivos > MS > Snacks e Aperitivos
Salgadinhos|Batata Palha|Pipoca Pronta > MS > Snacks e Aperitivos > Salgadinhos
Torradas > PD > Pães Industrializados > Torradas e Croutons

## BB
Bebidas
Bebidas Alcóolicas > BB > ALCÓOLICAS
Alcoólicos Congelados|Caipirinha|Coquetéis|Drink Pronto > BB > Destilados e Licores > Drinks Prontos
Destilados|Aguardente|Conhaque|Gin|Saquê|Tequila|Vodka|Whisky > BB > Destilados e Licores > Destilados
Licores|Licor Aperitivo > BB > Destilados e Licores > Licores e Aperitivos
Cervejas > BB > Cervejas
Cervejas Escura|Cervejas Pilsen|Cervejas Premium|Cervejas Saborizadas|Cervejas Sem Álcool|Cervejas Especiais e Artesanais > BB > Cervejas
Cerveja Escura Importada|Cerveja Pielsen Importada|Cerveja Premium Importada|Cerveja Sem Álcool Importada|Cerveja Especial e Artesanal Importada|Cerveja Especial e Artesanal Nacional|Kit de Cerveja Especial e Artesanal > BB > Cervejas > Cervejas Especiais e Importadas
Cerveja Escura Nacional|Kit de Cerveja Escura|Cerveja Pielsen Nacional|Kit de Cerveja Pielsen|Cerveja Premium Nacional|Cerveja Premium Orgânica|Kit de Cerveja Premium|Cerveja Premium Barril|Cerveja Saborizada Nacional|Cerveja Sem Álcool Nacional|Kit Cerveja Sem Álcool > BB > Cervejas > Cervejas Nacionais
Não Alcoólicas > BB
Chá Pronto|Chá Pronto Para Beber|Chás Refrigerados|Kombuchas > BB > Bebidas Funcionais > Chás Prontos e Kombuchas
Coquetéis Não Alcoólicos|Drink Pronto Não Alcóolico > BB > Destilados e Licores > Drinks Prontos
Energético|Energético Importado|Energético Nacional > BB > Bebidas Funcionais > Energéticos
Hidratação > BB > ÁGUAS E SUCOS
Água Saborizada|Água com Gás|Água sem Gás|Água Especial > BB > ÁGUAS E SUCOS > Água Mineral
Água de Coco > BB > ÁGUAS E SUCOS > Água de Coco
Isotônico > BB > Bebidas Funcionais > Isotônicos e Esportivos
Não Alcoólicos Congelados|Sucos, Frutas e Polpas Congelados > BB > Sucos e Néctares > Sucos Concentrados e Polpas
Gelo > BB > Mixers e Gelo > Gelo
Refresco|Refresco em Pó > MD > Achocolatados e Bebidas em Pó > Refrescos em Pó
Refrigerantes > BB > Refrigerantes
Cola > BB > Refrigerantes > Refrigerantes de Cola
Demais Refrigerantes|Guaraná > BB > Refrigerantes > Refrigerantes de Sabores
Tônica > BB > Mixers e Gelo > Mixers
Sucos > BB > Sucos e Néctares
Bebida Mista|Suco Integral|Suco Natural|Suco Pronto|Suco Refrigerado Pronto > BB > Sucos e Néctares > Sucos Prontos
Bebidas Vegetais > MD > Leite Longa Vida e em Pó > Bebidas Vegetais
Suco Concentrado > BB > Sucos e Néctares > Sucos Concentrados e Polpas
Vinhos > BB > Vinhos e Espumantes
Brancos|Rosés|Vinho Branco Argentino|Vinho Branco Chileno|Vinho Branco Francês|Vinho Branco Italiano|Vinho Branco Nacional|Outros Paises - Vinhos Brancos|Vinho Branco Português|Vinho Branco Espanhol|Vinho Branco Meia Garrafa|Vinho Rosé Argentino|Vinho Rosé Chileno|Vinho Rosé Francês|Vinho Rosé Italiano|Vinho Rosé Nacional|Outros Paises - Vinhos Rosé|Vinho Rosé Português|Vinho Rosé Espanhol|Vinho Rosé Meia Garrafa > BB > Vinhos e Espumantes > Vinhos Brancos e Rosés
Espumante|Espumante Importado|Espumante Nacional|Sidra|Sidra - Sem Álcool > BB > Vinhos e Espumantes > Espumantes
Tintos|Vinho Tinto Argentino|Vinho Tinto Chileno|Vinho Tinto Francês|Vinho Tinto Italiano|Vinho Tinto Nacional|Outros Paises - Vinhos Tintos|Vinho Tinto Português|Vinho Tinto Meia Garrafa|Vinho Tinto Espanhol > BB > Vinhos e Espumantes > Vinhos Tintos

## LC
Limpeza
Acessórios de Limpeza|Bacia|Balde|Desentupidores|Escova|Feirinha|Lixeira|Luva|Pá para Lixo|Rodo|Vassoura|Outros Acessórios de Limpeza > LC > Limpeza da Casa > Utensílios de Limpeza
Lã de Aço e Esponja|Pano e Flanela > LC > Limpeza da Cozinha > Esponjas e Panos
Odorizador|Desodorizador > LC > Ambiente e Controle de Pragas > Aromatizantes
Cuidados com a Roupa > LC > Cuidados com Roupas
Alvejante|Amaciante|Facilitadores - Passa Roupas|Tira Manchas > LC > Cuidados com Roupas > Amaciantes e Tratamento
Lava Roupas em Pó|Lava Roupas Liquido > LC > Cuidados com Roupas > Sabão para Roupas
Limpeza da Cozinha > LC > Limpeza da Cozinha
Detergente > LC > Limpeza da Cozinha > Lava-Louças
Desengordurante|Limpa Alumínio|Limpa Forno > LC > Limpeza da Cozinha > Desengordurantes
Limpeza de Banheiro > LC > Limpeza da Casa > Banheiro
Desinfetante|Limpador Sanitário > LC > Limpeza da Casa > Banheiro
Limpeza Geral > LC > Limpeza da Casa
Água Sanitária|Álcool|Limpa Vidro|Limpadores|Sabão|Limpa Carpete > LC > Limpeza da Casa > Limpadores Multiuso
Proteção para Casa > LC > Ambiente e Controle de Pragas
Inseticidas > LC > Ambiente e Controle de Pragas > Inseticidas
Descartáveis|Casa e Cozinha > LC > Descartáveis e Embalagens
Artigos para Festa|Acessório para Festa|Vela de Aniversário > BZ > Sazonais e Festas > Festas
Coador de Papel|Cozinhar e Armazenar|Papel Toalha|Protetor de Alumínio para Fogão|Rolo de Alumínio > LC > Descartáveis e Embalagens > Papel e Filmes
Copo Descartável|Guardanapo|Palito|Prato Descartável|Talher Descartável > LC > Descartáveis e Embalagens > Descartáveis de Mesa
Fósforo|Vela Comum > ?
Sacos para Lixo > LC > Limpeza da Casa > Sacos de Lixo

## CP
Descartáveis Higiênicos > CP > Higiene Íntima e Pessoal
Absorvente > CP > Higiene Íntima e Pessoal > Absorventes
Fralda Adulto > CP > Higiene Íntima e Pessoal
Lenço de Papel|Lenço Umedecido|Papel Higiênico > CP > Higiene Íntima e Pessoal > Papel e Lenços

## MI
Bebê e Criança
Cuidados Pessoais Infantil|Creme Dental Infantil|Cuidados com Cabelo Infantil|Cuidados com Corpo Infantil|Escova Dental Infantil|Higiene Bucal Infantil > MI > Higiene do Bebê > Cuidados do Bebê
Fralda Infantil > MI > Higiene do Bebê > Fraldas
Nutrição Infantil|Cereais Infantil|Complemento Nutrição Infantil|Papinhas > MI > Alimentação Infantil > Papinhas e Cereais Infantis
Leites e Fórmulas > MI > Alimentação Infantil > Fórmulas e Leites Infantis

## CP
Perfumaria
Cuidados com Cabelo|Acessórios para o Cabelo > CP > Cabelo
Coloração do Cabelo|Fixadores > CP > Cabelo > Coloração e Styling
Condicionador|Shampoo > CP > Cabelo > Shampoos e Condicionadores
Hidratação e Tratamento do Cabelo > CP > Cabelo > Tratamento Capilar
Cuidados com Corpo > CP > Cuidados com o Corpo
Acessórios Descartáveis|Acessórios para Banho > CP > Banho
Álcool em Gel > CP > Farmácia Básica > Primeiros Socorros
Desodorante > CP > Cuidados com o Corpo > Desodorantes
Hidratação e Tratamento do Corpo|Proteção Labial|Hidratação Labial > CP > Cuidados com o Corpo > Hidratantes e Óleos
Perfume > CP > Perfumaria > Fragrâncias
Preservativos > CP > Farmácia Básica > Preservativos e Lubrificantes
Repelentes > ?
Sabonete > CP > Cuidados com o Corpo > Sabonetes
Cuidados com Rosto|Maquiagem > CP > Cuidados com o Rosto e Maquiagem
Proteção Solar > CP > Cuidados com o Corpo > Proteção Solar
Hidratação e Tratamento do Rosto > CP > Cuidados com o Rosto e Maquiagem > Skincare
Pós Barba|Depilação|Cutelaria|Acessórios de Cutelaria|Kit de Cutelaria > CP > Barbear e Depilação
Pinça|Unhas > CP > Mãos e Pés
Higiene Bucal > CP > Higiene Bucal
Creme Dental > CP > Higiene Bucal > Cremes Dentais
Enxaguante Bucal > CP > Higiene Oral
Escova Dental|Fio Dental|Limpador de Língua > CP > Higiene Bucal > Acessórios Bucais
Acessórios Perfumaria|Necessaire > ?

## PT
PetShop
Brinquedos e Utilidades|Brinquedos e Utilidades - Cães|Brinquedos e Utilidades - Gatos|Brinquedos e Utilidades - Outros Pets|Brinquedos e Utilidades - Aves|Brinquedos e Utilidades - Peixes > PT > Acessórios Pet > Acessórios
Cuidado e Higiene > PT
Higiene - Cães > PT > Cães > Higiene para Cães
Higiene - Gatos > PT > Gatos > Higiene para Gatos
Ração > PT
Ração - Aves|Ração - Peixes|Ração - Outros Pets > PT > Outros Pets > Pássaros, Peixes e Roedores
Ração - Cães > PT > Cães > Alimentação para Cães
Ração - Gatos > PT > Gatos > Alimentação para Gatos
Snack e Biscoito > PT
Snack - Cães > PT > Cães > Petiscos para Cães
Snack - Gatos > PT > Gatos > Alimentação para Gatos

## BZ
Bazar
Automotivos|Limpeza e Manutenção Automotiva > BZ > Automotivo > Cuidados com o Veículo
Casa > BZ > Casa e Organização
Arrumação e Organização > BZ > Casa e Organização > Organização
Faça Você Mesmo > ?
Decoração Sazonal > BZ > Sazonais e Festas > Datas Comemorativas
Móveis e Colchões > ?
Cozinha > BZ > Utensílios de Cozinha
Decoração da Casa > BZ > Casa e Organização
Jardinagem|Acessórios e Ferramentas > BZ > Jardinagem e Churrasqueira > Jardinagem
Flores e Plantas > PL > FLORES
Lazer|Bicicletas|Brinquedos|Camping|Esporte|Praia e Piscina|Viagem > ?
Churrasco > BZ > Jardinagem e Churrasqueira
Papelaria e Livraria > BZ > Papelaria
Desenho e Escrita > BZ > Papelaria > Material Escolar e Escritório
Livros e Revistas|Livros|Álbuns > ?

## VS
Têxtil
Moda > VS > ROUPAS
Calçados > VS > CALÇADOS

## MARCA
Caras do Brasil|Produtos Especiais|Organização e Decoração|Opções Alimentares > #marca

## BZ
Eletro > BZ > Elétricos e Iluminação
Eletroportáteis|Eletroportáteis - Casa > BZ > Elétricos e Iluminação > Eletroportáteis
`;

const parsePath = (raw: string, defaultDept: string): string[] => raw.split('>').map(s => s.trim()).filter(Boolean).map((s, i) => (i === 0 && DEPTS[s] ? DEPTS[s] : s));

let cache: ExtraEquivalent[] | null = null;

/** Todas as equivalências, na ordem do Extra */
export function extraEquivalents(): ExtraEquivalent[] {
  if (cache) return cache;
  const out: ExtraEquivalent[] = [];
  let def: string[] = [];
  for (const line of EXTRA_MAP_TEXT.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (line.startsWith('##')) { def = parsePath(line.slice(2), ''); continue; }
    const i = line.indexOf(' > ');
    const names = (i < 0 ? line : line.slice(0, i)).split('|').map(s => s.trim()).filter(Boolean);
    const dest = i < 0 ? null : line.slice(i + 3).trim();
    names.forEach(extra => {
      if (dest === '?') out.push({ extra, path: [], kind: 'a decidir' });
      else if (dest === '#marca') out.push({ extra, path: [], kind: 'marca' });
      else if (dest === '#agrupador') out.push({ extra, path: [], kind: 'agrupador' });
      else if (dest === null) out.push({ extra, path: def, kind: 'nó' });
      else out.push({ extra, path: parsePath(dest, ''), kind: 'nó' });
    });
  }
  cache = out;
  return out;
}

const fold = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Equivalência de um nome do Extra (sem acento nem caixa). `undefined` se o nome não consta no mapa do Extra. */
export function extraEquivalentOf(name: string): ExtraEquivalent | undefined {
  const k = fold(name);
  return extraEquivalents().find(e => fold(e.extra) === k);
}
