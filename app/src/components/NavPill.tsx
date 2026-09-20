"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";
import { DOCS_URL } from "@/lib/stellar";

// Only what the MVP actually does. /agents, /policy and /network are still
// routes — a link to one resolves and says which issue brings it — but a
// primary nav where three of five entries are a notice reads as unfinished,
// which is the opposite of what it costs to leave them out (#63).
const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/new", label: "New job" },
];

const linkClass =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender";

export function NavPill() {
  const pathname = usePathname();
  return (
    <header className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-4">
      <nav
        aria-label="Primary"
        className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-fog bg-paper-white p-1.5 shadow-subtle-2"
      >
        <Link href="/" className={`${linkClass} gap-2 pl-3 text-carbon`}>
          <Logo className="size-4 text-carbon" />
          Square
        </Link>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-fog" />
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`${linkClass} ${active ? "bg-mist text-carbon" : "text-graphite hover:bg-linen hover:text-carbon"}`}
            >
              {link.label}
            </Link>
          );
        })}
        <a href={DOCS_URL} target="_blank" rel="noreferrer" className={`${linkClass} text-graphite hover:bg-linen hover:text-carbon`}>
          Docs
        </a>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-fog" />
        <WalletButton />
      </nav>
    </header>
  );
}
