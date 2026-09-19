export function UsdcMark({ className = "size-3.5" }: { className?: string }) {
  return <img src="/brand/usdc.svg" alt="" aria-hidden="true" width={14} height={14} className={`inline-block shrink-0 align-[-0.125em] ${className}`} />;
}

/** The Stellar symbol, for references to the network in running text. */
export function StellarMark({ className = "size-4" }: { className?: string }) {
  return <img src="/brand/stellar-mark.svg" alt="" aria-hidden="true" width={16} height={16} className={`inline-block shrink-0 align-[-0.15em] ${className}`} />;
}

/** The Stellar logo at its native 4:1 proportions. */
export function StellarLogo({ tone = "black", height = 32 }: { tone?: "black" | "white"; height?: number }) {
  const width = height * 4;
  return <img src={`/brand/stellar-logo-${tone}.svg`} alt="Stellar" width={width} height={height} style={{ height, width }} className="shrink-0" />;
}

export function BuiltOnStellar() {
  return (
    <a
      href="https://stellar.org"
      target="_blank"
      rel="noreferrer"
      aria-label="Built on Stellar"
      className="inline-flex items-center gap-4 rounded-full py-4 pl-4 pr-4 text-caption text-graphite transition-colors hover:text-carbon focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender"
    >
      <span>Built on</span>
      <StellarLogo height={32} />
    </a>
  );
}
