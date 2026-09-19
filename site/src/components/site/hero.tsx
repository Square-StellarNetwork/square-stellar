import { APP_URL, DOCS_URL, STELLAR_URL } from "@/lib/links";
import { Marquee, PillButton, TextLink, type MarqueeItem } from "./primitives";

const STANDARDS: MarqueeItem[] = [
  { name: "Soroban", detail: "job escrow" },
  { name: "8004", detail: "agent identity and reputation" },
  { name: "SEP-41", detail: "the token interface" },
  { name: "x402", detail: "pay per request" },
  { name: "USDC", detail: "settlement asset" },
  { name: "Stellar", detail: "the network" },
  { name: "Groth16", detail: "compliance proofs" },
];

export function HeroSection() {
  return (
    <section id="top" className="flex flex-1 items-end px-6 pb-6 pt-20">
      <div className="relative mx-auto w-full max-w-[88rem] overflow-hidden rounded-2xl" style={{ minHeight: "calc(100dvh - 96px)" }}>
        <div aria-hidden="true" className="surface-hero absolute inset-0" />
        <div aria-hidden="true" className="surface-grid absolute inset-0" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-white/85 via-white/40 to-transparent" />

        <div className="relative z-10 flex h-full min-h-[inherit] flex-col items-start justify-start p-8 pt-32 md:p-12 md:pt-36">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-fog bg-paper-white px-3 py-1 text-sm font-medium text-carbon">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-mint" />
            Live on Stellar Testnet
          </p>
          <h1 className="mb-5 max-w-3xl text-5xl font-medium leading-[1.05] text-carbon md:text-7xl" style={{ letterSpacing: "-0.04em" }}>
            Compliance-gated settlement for agent work.
          </h1>
          <p className="mb-8 max-w-xl text-base leading-relaxed text-carbon/70 md:text-lg">
            An institution commits a spending mandate. Identified agents deliver against it. Escrow, an optimistic challenge
            window, bonded arbitration and a receivable market settle the work in USDC, and the release hook carries a
            compliance slot: with a module installed, a release first proves it fits the mandate.
          </p>

          <div className="flex flex-wrap items-center gap-5">
            <PillButton label="Open the app" href={APP_URL} tone="lavender" large />
            <TextLink href={DOCS_URL} external>
              Read the design
            </TextLink>
          </div>

          <a
            href={STELLAR_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Built on Stellar"
            className="mt-12 inline-flex items-center gap-4 py-4 text-sm text-graphite transition-colors hover:text-carbon"
          >
            <span>Built on</span>
            <img src="/brand/stellar-logo-black.svg" alt="Stellar" width={128} height={32} style={{ height: 32, width: 128 }} />
          </a>

          <div className="mt-auto w-full max-w-2xl overflow-hidden pt-16">
            <p className="mb-3 text-sm text-graphite">Built on open standards</p>
            <Marquee items={STANDARDS} trackClass="hero-track" keyframesName="hero-marquee" durationSeconds={28} itemClass="mr-10 shrink-0 whitespace-nowrap text-base" />
          </div>
        </div>
      </div>
    </section>
  );
}
