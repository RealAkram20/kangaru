import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names, with later Tailwind utilities winning.
 *
 * Required by the Animate UI sources under `components/animate-ui/`, which
 * the shadcn registry distributes importing `@/lib/utils` by convention. It
 * is deliberately the stock implementation: this file is an integration
 * point for vendored code, and anything clever here would break the next
 * component pulled in from the registry.
 *
 * `twMerge` on top of `clsx` is what stops `px-2` and `px-4` both surviving
 * into the DOM, where the winner would be whichever CSS rule happened to be
 * declared last rather than the one the caller passed last.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
