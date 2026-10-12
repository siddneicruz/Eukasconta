import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.eukasconta.app',
  appName: 'Eu Kasconta',
  webDir: 'dist',
  backgroundColor: '#09090b',
  android: {
    allowMixedContent: false,
    backgroundColor: '#09090b',
    // Android 15 desenha o app por baixo das barras do sistema; isso devolve as margens.
    adjustMarginsForEdgeToEdge: 'auto',
  },
  plugins: {
    StatusBar: { style: 'DARK', backgroundColor: '#09090b', overlaysWebContent: false },
  },
};

export default config;
