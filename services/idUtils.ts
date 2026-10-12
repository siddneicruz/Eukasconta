// crypto.randomUUID() só existe em "contextos seguros" do navegador
// (https:// ou http://localhost). Ao acessar o app por http://IP-da-rede
// (ex: testando no celular pela rede local, ou publicado sem HTTPS), essa
// função simplesmente não existe e quebra o app inteiro.
// generateId() cobre os dois casos: usa a nativa quando disponível, e cai
// num gerador manual de UUID v4 quando não.
export const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 (RFC 4122) usando Math.random — suficiente para IDs
  // internos do app, não é usado para nada criptográfico.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
