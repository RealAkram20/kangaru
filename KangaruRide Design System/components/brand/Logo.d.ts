export interface LogoProps {
  /**
   * horizontal      — navy/green lockup for light surfaces (default)
   * horizontal-navy — white/green lockup, for navy chrome and dark heroes
   * stacked         — mark above wordmark, for login and print
   * mono            — single-colour black lockup, for documents and faxable PDFs
   * mark            — outlined circle mark only
   * mark-solid      — solid green circle mark only, for app icons and avatars
   */
  variant?: "horizontal" | "horizontal-navy" | "stacked" | "mono" | "mark" | "mark-solid";
  /** Rendered height in px. Minimum 24px for lockups, 20px for the mark. */
  height?: number;
  /** Path from the consuming page to the copied assets folder. */
  basePath?: string;
  /** With a mark variant, sets the wordmark in Sora beside it (used when the sidebar is expanded). */
  withWordmark?: boolean;
  style?: React.CSSProperties;
}

export declare function Logo(props: LogoProps): JSX.Element;
