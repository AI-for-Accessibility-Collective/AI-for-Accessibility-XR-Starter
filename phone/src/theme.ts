// Design tokens. Two palettes (the phone's light/dark setting picks one), each
// with a stronger version for the phone's contrast setting. One spacing
// scale, one type scale. Each text/background pair below meets WCAG AA
// contrast (4.5:1), and `control` edges meet 3:1 against bg and surface.
// Color does not carry state alone: each tone is paired with a glyph or a
// word where it is used.

import { createContext, createElement, useContext, type ReactNode } from 'react';
import { Platform, useColorScheme, type TextStyle } from 'react-native';
import { useA11ySettings } from './a11y';

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string; // cards and dividers
  control: string; // the edge of a field or a secondary button
  text: string;
  textMuted: string;
  accent: string; // text and edges in the accent color
  accentFill: string; // a filled button, under onAccent text
  onAccent: string;
  ok: string;
  okSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  go: string;
  stop: string;
}

const dark: Palette = {
  bg: '#0d1117',
  surface: '#161b22',
  surfaceAlt: '#1f2630',
  border: '#2d3643',
  control: '#5d697a',
  text: '#f0f4f9',
  textMuted: '#a3afbf',
  accent: '#4c8dff',
  accentFill: '#2563d9',
  onAccent: '#ffffff',
  ok: '#4cc38a',
  okSoft: '#12291f',
  warn: '#f2b84b',
  warnSoft: '#2e2410',
  danger: '#ff7b72',
  dangerSoft: '#30161a',
  go: '#1a7f45',
  stop: '#c43c30',
};

const light: Palette = {
  bg: '#f4f6f9',
  surface: '#ffffff',
  surfaceAlt: '#eef1f5',
  border: '#d5dbe3',
  control: '#7b8594',
  text: '#121821',
  textMuted: '#4f5b6b',
  accent: '#1f5fd6',
  accentFill: '#1f5fd6',
  onAccent: '#ffffff',
  ok: '#15703f',
  okSoft: '#e2f4ea',
  warn: '#8a5a00',
  warnSoft: '#fdf0d5',
  danger: '#b3261e',
  dangerSoft: '#fce8e6',
  go: '#1a7f45',
  stop: '#b3261e',
};

// iOS Increase Contrast, Android High contrast text: muted text close to full
// strength, and stronger edges.
const darkMore: Palette = { ...dark, textMuted: '#d8e0ea', border: '#5d697a', control: '#9aa6b6', surfaceAlt: '#27303c' };
const lightMore: Palette = { ...light, textMuted: '#2b3440', border: '#8a94a3', control: '#4f5b6b' };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;
// Sizes are starting points: the phone's text-size setting scales them. Body
// matches the iPhone's own default size (17).
export const type = { caption: 14, body: 17, lead: 19, title: 22, display: 28, speech: 22 } as const;
// The typeface is Atkinson Hyperlegible Next, built into the app (app.json,
// assets/fonts). Each text style takes it from font() or italic, so set the
// weight there in place of fontWeight. iOS finds each weight by its
// PostScript name. Android finds it by family and weight.
export type Weight = '400' | '600' | '700' | '800';
const FAMILY = 'Atkinson Hyperlegible Next';
const IOS_FACE: Record<Weight, string> = { '400': 'Regular', '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold' };
export const font = (weight: Weight = '400'): TextStyle =>
  Platform.OS === 'ios' ? { fontFamily: `AtkinsonHyperlegibleNext-${IOS_FACE[weight]}` } : { fontFamily: FAMILY, fontWeight: weight };
export const italic: TextStyle =
  Platform.OS === 'ios' ? { fontFamily: 'AtkinsonHyperlegibleNext-Italic' } : { fontFamily: FAMILY, fontStyle: 'italic' };

// Apple's minimum comfortable touch target is 44pt; controls here use more.
export const touch = 52;

// The camera screens (the phone as the glasses, the QR scanner) stay dark in
// either setting, like a camera app. Wrap them in <DarkScreen>.
const ForceDark = createContext(false);
export const DarkScreen = (props: { children: ReactNode }) => createElement(ForceDark.Provider, { value: true }, props.children);

export function usePalette(): Palette {
  const forceDark = useContext(ForceDark);
  const scheme = useColorScheme();
  const { moreContrast } = useA11ySettings();
  if (forceDark || scheme !== 'light') return moreContrast ? darkMore : dark;
  return moreContrast ? lightMore : light;
}
