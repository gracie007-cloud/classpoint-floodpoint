"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useScannerContext } from "@/contexts/scanner-context";

const navItems = [
  { href: "/", label: "Flooder" },
  { href: "/scanner", label: "Scanner" },
] as const;

/**
 * Navigation component with scanning status indicator
 */
export function Navigation() {
  const pathname = usePathname();
  const { isScanning } = useScannerContext();

  return (
    <nav className="flex items-center gap-1" role="navigation" aria-label="Main navigation">
      {navItems.map(({ href, label }) => {
        const isActive = pathname === href;
        const showIndicator = href === "/scanner" && isScanning;
        
        return (
          <Link
            key={href}
            href={href}
            className={`relative px-4 py-2 text-sm font-medium rounded-lg transition-colors duration-150 ${
              isActive
                ? "bg-[hsl(var(--fp-sky))] text-white"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            {label}
            {showIndicator && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

Navigation.displayName = "Navigation";
