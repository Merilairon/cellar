export const THEME_COOKIE = 'theme';
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(v: string | undefined): Theme {
  return THEMES.includes(v as Theme) ? (v as Theme) : 'system';
}

export function nextTheme(t: Theme): Theme {
  return THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
}
