"use client";

import { formatAmount } from "@/lib/format";
import { usePaymentTokenLabel } from "@/lib/square";
import { StellarMark, UsdcMark } from "./marks";

/**
 * An amount in the payment token's base units, with the token it is in. The
 * testnet MVP funds in XLM; a stack whose kernel holds USDC says USDC. Both
 * have seven decimals.
 */
export function Amount({ value, className = "", unit = true, mark = true }: { value: bigint; className?: string; unit?: boolean; mark?: boolean }) {
  const label = usePaymentTokenLabel();
  return (
    <span className={`tabular-nums ${className}`}>
      {formatAmount(value)}
      {unit ? (
        <span className="text-ash">
          {" "}
          {mark ? label === "USDC" ? <UsdcMark className="mr-1 size-3.5" /> : <StellarMark className="mr-1 size-3.5" /> : null}
          {label}
        </span>
      ) : null}
    </span>
  );
}
