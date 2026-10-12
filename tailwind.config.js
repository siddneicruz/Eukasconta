/** @type {import('tailwindcss').Config} */
// Antes esta configuração vivia num <script> dentro do index.html e o Tailwind
// era baixado da CDN a cada abertura do app. Agora o CSS é gerado no build e
// vai embutido no pacote — essencial para o app instalado funcionar offline.
export default {
  content: ['./index.html', './*.{ts,tsx}', './components/**/*.{ts,tsx}', './services/**/*.{ts,tsx}'],
  theme: {
    // "md" (layout de computador/tablet) exige largura >= 768px E altura > 500px.
    // Sem a condição de altura, um celular deitado (ex: 873x393) cairia no
    // layout de computador, com menu no topo e pouquíssimo espaço vertical.
    screens: {
      sm: '640px',
      md: { raw: '(min-width: 768px) and (min-height: 501px)' },
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
      // ls: celular deitado (paisagem com pouca altura). Uso: ls:flex-row
      ls: { raw: '(orientation: landscape) and (max-height: 500px)' },
    },
    extend: {
      colors: {
        background: '#09090b',
        surface: '#18181b',
        surfaceHighlight: '#27272a',
        border: 'rgba(255, 255, 255, 0.08)',
        luxury: {
          gold: '#D4AF37',
          goldDim: '#997B28',
          accent: '#F59E0B',
        },
      },
      fontFamily: {
        serif: ['Cinzel', 'serif'],
        sans: ['Inter', 'sans-serif'],
      },
      backgroundImage: {
        'subtle-gradient': 'radial-gradient(circle at top right, rgba(212, 175, 55, 0.05), transparent 40%)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
