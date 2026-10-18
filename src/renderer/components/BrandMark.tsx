import { Sparkle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * The steward's mark: a small gradient tile with a spark. Used in the sidebar,
 * the boot screen, and the empty conversation so the product has one anchor.
 */
export function BrandMark({
  size = 'md',
  glow = false,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  glow?: boolean;
  className?: string;
}) {
  const box =
    size === 'sm'
      ? 'size-5 rounded-[6px]'
      : size === 'md'
        ? 'size-7 rounded-lg'
        : 'size-12 rounded-2xl';
  const icon = size === 'sm' ? 11 : size === 'md' ? 15 : 24;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-brand-gradient relative inline-flex shrink-0 items-center justify-center text-brand-contrast',
        glow && 'shadow-brand',
        box,
        className,
      )}
    >
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white/25 to-transparent opacity-70" />
      <Sparkle size={icon} weight="fill" className="relative" />
    </span>
  );
}

/** A larger, breathing version for empty states and the boot screen. */
export function BrandOrb({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex items-center justify-center',
        className,
      )}
    >
      <span className="absolute inset-0 animate-pulse-ring rounded-full border border-brand/30" />
      <span className="absolute inset-2 animate-pulse-ring rounded-full border border-brand/20 [animation-delay:0.8s]" />
      <span className="absolute inset-0 rounded-full bg-brand/10 blur-xl" />
      <BrandMark size="lg" glow className="relative" />
    </span>
  );
}
