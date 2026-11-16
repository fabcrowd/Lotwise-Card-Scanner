// The extension's design tokens (tools/extension-wasm/ui/tokens.css, "Slab and viewfinder"), as values a phone
// screen can use. Light and dark follow the system setting, as the popup does. The extension's two fonts ship as
// woff2, which React Native cannot load, so the app uses the system font until TTF copies are added.

import { useColorScheme } from 'react-native';

export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  borderStrong: string;
  ink: string;
  ink2: string;
  ink3: string;
  primaryBg: string;
  primaryFg: string;
  brand: string;
  brandFg: string;
  brandTint: string;
  ok: string;
  okTint: string;
  info: string;
  infoTint: string;
  /** Amber: "pick the card". The color of everything that waits for the user. */
  ask: string;
  askFill: string;
  askTint: string;
  danger: string;
  dangerTint: string;
}

const light: Palette = {
  bg: '#F3F3F7',
  surface: '#FFFFFF',
  surface2: '#F7F7FA',
  border: '#E2E2EA',
  borderStrong: '#8A889F',
  ink: '#17152B',
  ink2: '#4A4862',
  ink3: '#6B6982',
  primaryBg: '#17152B',
  primaryFg: '#FFFFFF',
  brand: '#5B3FE6',
  brandFg: '#FFFFFF',
  brandTint: '#EEEAFE',
  ok: '#0B7A53',
  okTint: '#E3F6EE',
  info: '#1D5FD6',
  infoTint: '#E6EEFC',
  ask: '#9A5300',
  askFill: '#F59E0B',
  askTint: '#FFF3D9',
  danger: '#B42318',
  dangerTint: '#FDECEA',
};

const dark: Palette = {
  bg: '#0F0E1A',
  surface: '#191729',
  surface2: '#211F36',
  border: '#2E2B47',
  borderStrong: '#7572A0',
  ink: '#EFEEF8',
  ink2: '#C3C1D9',
  ink3: '#9D9AB8',
  primaryBg: '#EFEEF8',
  primaryFg: '#17152B',
  brand: '#A795FF',
  brandFg: '#17152B',
  brandTint: '#2A2356',
  ok: '#3DD9A0',
  okTint: '#10372B',
  info: '#7FB0FF',
  infoTint: '#14294F',
  ask: '#FBBF24',
  askFill: '#F59E0B',
  askTint: '#3A2A08',
  danger: '#FF8A80',
  dangerTint: '#45181A',
};

export const radius = { sm: 6, md: 10, lg: 14 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
/** A card is 63 x 88 mm. */
export const CARD_ASPECT = 63 / 88;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
