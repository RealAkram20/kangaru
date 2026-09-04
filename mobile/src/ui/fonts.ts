import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';
import { useFonts } from 'expo-font';

/**
 * The five faces DESIGN.md §6 asks for, and only those five.
 *
 * Each one is a file in the bundle, so the list is a budget rather than a
 * convenience: Sora ships SemiBold and Bold because it is display-only, and
 * anything that wants to feel lighter than SemiBold is Inter by definition.
 *
 * The keys are load-bearing — they become the `fontFamily` strings the theme
 * names, so they must stay in step with `fonts` in `theme.ts`.
 *
 * JetBrains Mono, the third family in DESIGN.md, is deliberately absent. Its
 * job there is making identifiers scannable in dense finance tables, and this
 * app has no table in it; carrying a font file per screen that shows a trip
 * reference would be paying bundle size for a distinction nobody is scanning.
 */
export function useBrandFonts(): boolean {
  const [loaded, error] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  // A font that fails to decode must not hold the app at a splash screen
  // forever. React Native falls back to the system face, which is ugly and
  // entirely legible — and a driver who cannot start a trip because a typeface
  // did not load has been failed far worse than one looking at Roboto.
  return loaded || error !== null;
}