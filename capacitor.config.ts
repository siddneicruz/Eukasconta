import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.eukasconta.app',
  appName: 'Eu Kasconta',
  webDir: 'dist',
  backgroundColor: '#0A0A0C',
  android: {
    allowMixedContent: false,
    backgroundColor: '#0A0A0C',
    // Android 15 desenha o app por baixo das barras do sistema; isso devolve as margens.
    adjustMarginsForEdgeToEdge: 'auto',
  },
  plugins: {
    StatusBar: { style: 'DARK', backgroundColor: '#0A0A0C', overlaysWebContent: false },
  },
};

export default config;
