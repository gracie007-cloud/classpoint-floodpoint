/**
 * Minimal footer component
 */
export function Footer() {
  return (
    <footer className="text-sm text-muted-foreground">
      Built by{" "}
      <a
        href="https://github.com/avkean"
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground hover:text-[hsl(var(--fp-sky))] transition-colors duration-150"
      >
        avkean
      </a>
      <span className="mx-2 opacity-30">·</span>
      <a
        href="https://github.com/avkean/floodpoint"
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground hover:text-[hsl(var(--fp-sky))] transition-colors duration-150"
      >
        Source
      </a>
    </footer>
  );
}

Footer.displayName = "Footer";
