import { IconContext } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/**
 * One icon voice for the whole app. Phosphor's regular weight is a hair thin
 * at the 12–16px sizes this UI lives at, so bold is the default; individual
 * icons can still opt into another weight or size.
 */
export function IconProvider({ children }: { children: ReactNode }) {
  return (
    <IconContext.Provider value={{ size: 16, weight: 'bold' }}>
      {children}
    </IconContext.Provider>
  );
}
