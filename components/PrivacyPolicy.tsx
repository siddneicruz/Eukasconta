import React, { useEffect } from 'react';
import { X, ShieldCheck } from 'lucide-react';

// Política de privacidade exibida dentro do app. O mesmo texto está em public/privacidade.html
// (endereço público exigido pelas lojas de aplicativos). Revisão jurídica recomendada antes da publicação.
export const PRIVACY_SECTIONS: { t: string; p: string[] }[] = [
  { t: 'O que o Eukasconta faz', p: ['O Eukasconta lê seus cupons fiscais, organiza seus gastos por categoria e compara preços de produtos entre estabelecimentos.'] },
  { t: 'Dados que ficam só no seu aparelho', p: ['Seus cupons, itens, metas e configurações ficam guardados no próprio aparelho. Nada disso vai para a nuvem sem que você crie uma conta e ative o backup.'] },
  { t: 'Dados da conta e do backup (opcional)', p: ['Se você criar uma conta, guardamos seu e-mail, nome de exibição e, caso ative, o backup dos seus cupons. Esses dados são vinculados à sua conta e só você os acessa.'] },
  { t: 'Contribuição de preços', p: ['Quando você participa, o preço de um produto em um estabelecimento (CNPJ, produto, valor e data) é somado aos de outras pessoas para formar as comparações. Essa contribuição não carrega seu nome, e-mail nem identificador de conta. Você pode desligar a participação em Ajustes › Conta.'] },
  { t: 'Avaliações de qualidade', p: ['As notas de qualidade que você dá aos hortifrútis são vinculadas à sua conta para limitar abusos; o app mostra aos outros apenas a média por loja, nunca quem avaliou.'] },
  { t: 'Leitura por inteligência artificial', p: ['Ao ler um cupom com IA, a imagem ou o texto do cupom é enviado ao provedor de IA configurado, apenas para extrair os itens. Não usamos o conteúdo para publicidade.'] },
  { t: 'Localização', p: ['Se você permitir, usamos a localização aproximada apenas para mostrar lojas e preços por perto. Você pode negar ou revogar a permissão no aparelho.'] },
  { t: 'Seus direitos', p: ['Você pode ver, exportar (Ajustes › Backup e dados) e apagar seus dados. Para apagar a conta e tudo o que está na nuvem, use Ajustes › Conta › Excluir minha conta. A exclusão é definitiva. Dados guardados só no aparelho são removidos ao desinstalar o app.'] },
  { t: 'Contato', p: ['Dúvidas ou pedidos sobre seus dados: eukasconta@gmail.com.'] },
];

const PrivacyPolicy: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md" onClick={onClose} data-testid="privacy-policy">
      <div role="dialog" aria-modal="true" aria-label="Política de privacidade" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto bg-[#0c0c0e] border border-white/10 rounded-t-[2rem] sm:rounded-[2rem] p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3"><ShieldCheck className="w-5 h-5 text-luxury-gold" /><h2 className="font-serif text-lg text-white">Política de privacidade</h2></div>
          <button onClick={onClose} aria-label="Fechar" className="w-9 h-9 rounded-full border border-white/10 text-zinc-400 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-5">
          {PRIVACY_SECTIONS.map(s => (
            <section key={s.t}>
              <h3 className="text-[13px] font-bold text-luxury-gold mb-1.5">{s.t}</h3>
              {s.p.map((x, i) => <p key={i} className="text-sm text-zinc-300 leading-relaxed">{x}</p>)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
