import { IconContext } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/**
 * One icon voice for the whole app. Phosphor's regular weight is a hair thin
 * at the 12–16px sizes this UI lives at, so bold is the default; individual
 * icons can still opt into another weight or size.
 */
/** Module-level: one stable object, so icon consumers never re-render for it. */
const ICON_DEFAULTS = { size: 16, weight: 'bold' } as const;

export function IconProvider({ children }: { children: ReactNode }) {
  return (
    <IconContext.Provider value={ICON_DEFAULTS}>
      {children}
    </IconContext.Provider>
  );
}
