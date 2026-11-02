-- Publicação da tabela mãe em pedaços (cada pedido do servidor é cortado em 8 s).
-- As funções publish_master_nodes, publish_master_products e publish_master_finish já estão no banco
-- (criadas em 02/11/2026); este arquivo registra a coluna usada para saber o que saiu da estrutura.
alter table public.taxonomy_master add column if not exists pub_batch uuid;
