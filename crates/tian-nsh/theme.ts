// Tian Sky tokens: docs/design-language.md (branch main).
// Every surface is achromatic. Colour is identity, state, or a diff line.

export type Look = 'night' | 'day';

export interface Palette {
  page: string;
  wall: string;
  win: string;
  winSolid: string;
  side: string;
  card: string;
  card2: string;
  line: string;
  line2: string;
  text: string;
  text2: string;
  text3: string;
  bubble: string;
  bubbleText: string;
  glass: string;
  glassLine: string;
  code: string;
  add: string;
  addBg: string;
  del: string;
  delBg: string;
  work: string;
  wait: string;
  fail: string;
  rim: string;
  rimStrong: string;
  e3: string;
  e4: string;
  sun: string;
  spot: string;
  windowShadow: string;
  inside: string;
  float: string;
}

export const night: Palette = {
  page: '#06070b',
  wall: [
    'radial-gradient(circle farthest-side at 78% 100%, rgba(255, 111, 145, 0.34), transparent 62%)',
    'radial-gradient(circle farthest-side at 8% 0%, rgba(94, 200, 255, 0.22), transparent 60%)',
    'radial-gradient(circle farthest-side at 45% 40%, rgba(139, 124, 255, 0.10), transparent 70%)',
    'linear-gradient(180deg, #0b1022, #05060a)',
  ].join(', '),
  win: 'rgba(14, 16, 23, 0.80)',
  winSolid: '#10121a',
  side: 'rgba(255, 255, 255, 0.03)',
  card: 'rgba(255, 255, 255, 0.045)',
  card2: 'rgba(255, 255, 255, 0.075)',
  line: 'rgba(255, 255, 255, 0.08)',
  line2: 'rgba(255, 255, 255, 0.15)',
  text: '#eeece6',
  text2: '#a9a8b3',
  text3: '#6f6f7d',
  bubble: '#eeece6',
  bubbleText: '#111217',
  glass: 'rgba(30, 32, 44, 0.55)',
  glassLine: 'rgba(255, 255, 255, 0.14)',
  code: 'rgba(0, 0, 0, 0.32)',
  add: '#52d6a0',
  addBg: 'rgba(63, 205, 150, 0.12)',
  del: '#ff8a80',
  delBg: 'rgba(255, 110, 100, 0.12)',
  work: '#5ee6c9',
  wait: '#ffc25c',
  fail: '#ff7a6b',
  rim: 'inset 0 1px 0 rgba(255, 255, 255, 0.07)',
  rimStrong: 'inset 0 1px 0 rgba(255, 255, 255, 0.16)',
  e3: '0 20px 50px -28px rgba(0, 0, 0, 0.75)',
  e4: '0 30px 80px -20px rgba(0, 0, 0, 0.82)',
  sun: 'rgba(255, 140, 150, 0.09)',
  spot: 'rgba(255, 255, 255, 0.06)',
  windowShadow:
    'inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 50px 140px -30px rgba(0, 0, 0, 0.80), 0 0 0 1px rgba(255, 255, 255, 0.07)',
  inside: [
    'radial-gradient(circle farthest-side at 78% 108%, rgba(255, 111, 145, 0.20), transparent 62%)',
    'radial-gradient(circle farthest-side at 6% -8%, rgba(94, 200, 255, 0.12), transparent 60%)',
    'radial-gradient(circle farthest-side at 45% 40%, rgba(139, 124, 255, 0.08), transparent 70%)',
    'linear-gradient(180deg, #0b0d17, #06070c)',
  ].join(', '),
  float: 'rgba(18, 20, 30, 0.94)',
};

export const day: Palette = {
  page: '#ece8e1',
  wall: [
    'radial-gradient(circle farthest-side at 80% 100%, rgba(255, 140, 120, 0.45), transparent 62%)',
    'radial-gradient(circle farthest-side at 5% 0%, rgba(120, 190, 255, 0.45), transparent 60%)',
    'linear-gradient(180deg, #f6efe6, #e9e3f0)',
  ].join(', '),
  win: 'rgba(253, 251, 247, 0.82)',
  winSolid: '#f8f6f2',
  side: 'rgba(20, 20, 40, 0.025)',
  card: 'rgba(255, 255, 255, 0.78)',
  card2: 'rgba(20, 20, 40, 0.045)',
  line: 'rgba(20, 20, 40, 0.09)',
  line2: 'rgba(20, 20, 40, 0.17)',
  text: '#15161b',
  text2: '#5c5d68',
  text3: '#9898a3',
  bubble: '#15161b',
  bubbleText: '#f4f2ed',
  glass: 'rgba(255, 255, 255, 0.62)',
  glassLine: 'rgba(255, 255, 255, 0.80)',
  code: 'rgba(20, 20, 40, 0.045)',
  add: '#0f8a5a',
  addBg: 'rgba(20, 160, 100, 0.10)',
  del: '#c2392d',
  delBg: 'rgba(220, 60, 50, 0.09)',
  work: '#0b9e80',
  wait: '#c98200',
  fail: '#d9483b',
  rim: 'inset 0 1px 0 rgba(255, 255, 255, 0.90)',
  rimStrong: 'inset 0 1px 0 #fff',
  e3: '0 20px 50px -28px rgba(60, 40, 80, 0.32)',
  e4: '0 30px 80px -24px rgba(60, 40, 80, 0.42)',
  sun: 'rgba(255, 150, 130, 0.12)',
  spot: 'rgba(255, 170, 150, 0.16)',
  windowShadow:
    'inset 0 1px 0 #fff, 0 50px 120px -40px rgba(60, 40, 80, 0.45), 0 0 0 1px rgba(20, 20, 40, 0.08)',
  inside: [
    'radial-gradient(circle farthest-side at 80% 110%, rgba(255, 140, 120, 0.22), transparent 62%)',
    'radial-gradient(circle farthest-side at 4% -10%, rgba(120, 190, 255, 0.18), transparent 60%)',
    'linear-gradient(180deg, #f3ede5, #ece7f0)',
  ].join(', '),
  float: 'rgba(248, 246, 242, 0.95)',
};

export const palette = (look: Look): Palette => (look === 'day' ? day : night);

export const DAWN =
  'linear-gradient(135deg, #ffb86b 0%, #ff6f91 48%, #8b7cff 100%)';
export const DAWN_CONIC =
  'conic-gradient(from 0deg, #ffb86b, #ff6f91, #8b7cff, #5ec8ff, #ffb86b)';

export const HUES = {
  atlas: '#5ee6c9',
  juno: '#ffc25c',
  vega: '#a99bff',
} as const;

export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
