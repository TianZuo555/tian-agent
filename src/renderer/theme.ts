import { useSyncExternalStore } from 'react';

/**
 * Appearance preferences. Like the locale, these live in localStorage rather
 * than the service: they describe this window's look, not Tian's state. The
 * store also builds under Node's test runner, which has no localStorage, so
 * every access is guarded.
 */
export type Theme = 'system' | 'light' | 'dark';

const THEME_KEY = 'tian.theme';
const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === 'light' || raw === 'dark' || raw === 'system'
      ? raw
      : 'system';
  } catch {
    return 'system';
  }
}

let theme: Theme = readTheme();

/**
 * Resolve "system" against the OS once, at boot, and write the result to the
 * document. `dark` is the single switch every token block and `dark:`
 * utility keys off, so a manual choice and the OS setting take the same path.
 */
function applyTheme() {
  try {
    const root = document.documentElement;
    const dark =
      theme === 'dark' ||
      (theme === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch {
    /* no DOM in tests */
  }
}
applyTheme();

// Follow the OS while the choice stays "system".
try {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (theme === 'system') applyTheme();
    });
} catch {
  /* no matchMedia in tests */
}

export function getTheme(): Theme {
  return theme;
}

export function setTheme(next: Theme): void {
  if (next === theme) return;
  theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* this window only */
  }
  applyTheme();
  for (const listener of listeners) listener();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => theme,
  );
}

/** Re-apply the stored theme; the boot screen calls this before painting. */
export function initTheme(): void {
  applyTheme();
}
