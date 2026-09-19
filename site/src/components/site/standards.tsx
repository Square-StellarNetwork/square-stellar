import { Marquee, type MarqueeItem } from "./primitives";

const STACK: MarqueeItem[] = [
  { name: "Stellar Testnet", detail: "protocol 27" },
  { name: "USDC", detail: "issued by Circle, 7 decimals" },
  { name: "Soroban", detail: "escrow, arbitration, receivable market" },
  { name: "8004", detail: "identity, reputation, validation" },
  { name: "Soroban authorization", detail: "signed entries, no approve step" },
  { name: "x402 v2", detail: "HTTP payments" },
  { name: "Groth16 on BN254", detail: "CAP-0074 host functions" },
  { name: "Rust", detail: "unit, fuzz and invariant tests" },
];

export function StandardsSection() {
  return (
    <section id="standards" className="bg-mist px-6 py-10">
      <div className="mx-auto grid max-w-[88rem] grid-cols-1 items-center gap-8 md:grid-cols-4">
        <p className="text-base leading-relaxed text-carbon/70">
          Built on open standards
          <br />
          and public infrastructure, not a partner list.
        </p>
        <div className="overflow-hidden md:col-span-3">
          <Marquee items={STACK} trackClass="stack-track" keyframesName="stack-marquee" durationSeconds={34} itemClass="mr-12 shrink-0 whitespace-nowrap text-base" />
        </div>
      </div>
    </section>
  );
}
