"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColors, chartFont, formatCompactAmount, type FeeTotals } from "@/lib/charts";
import { usePaymentTokenLabel } from "@/lib/square";
import { ChartFrame, ChartPlaceholder } from "./ChartFrame";

const HEIGHT = 220;

interface Row {
  key: string;
  label: string;
  value: number;
  color: string;
}

function FeeTooltip({ active, payload, token }: { active?: boolean; payload?: { payload: Row }[]; token: string }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-xl border border-fog bg-paper-white px-4 py-3 shadow-subtle-2">
      <p className="text-caption font-medium text-carbon">{row.label}</p>
      <p className="text-caption tabular-nums text-graphite">{formatCompactAmount(row.value)} {token}</p>
    </div>
  );
}

export function FeeTotalsChart({ totals, scanned, loading, error }: { totals: FeeTotals | null; scanned: number; loading: boolean; error?: string | null }) {
  const token = usePaymentTokenLabel();
  const rows: Row[] = totals
    ? [
        { key: "net", label: "Paid to providers", value: totals.netPaid, color: chartColors.lavender },
        { key: "platform", label: "Platform fees", value: totals.platform, color: chartColors.carbon },
        { key: "refunded", label: "Refunded to clients", value: totals.refunded, color: chartColors.magenta },
      ]
    : [];
  const nothing = totals !== null && totals.completed === 0 && totals.rejected === 0 && totals.refundedJobs === 0;
  return (
    <ChartFrame
      title="Settled on recent jobs"
      description={`Where ${token ? `escrowed ${token}` : "the escrow"} went on the jobs that reached a terminal status.`}
      caption={
        totals
          ? `${totals.completed} completed, ${totals.rejected} rejected and ${totals.refundedJobs} expired among the ${scanned} most recent jobs. Finalizing credits the provider the budget less the platform fee at the job's own basis points; a rejection and a refund each credit the whole budget back to the client. The kernel keeps per-account balances, not per-job settlement rows.`
          : `Computed over the ${scanned} most recent job records.`
      }
    >
      {loading ? (
        <ChartPlaceholder height={HEIGHT} label="Reading job records from the chain" />
      ) : error ? (
        <ChartPlaceholder height={HEIGHT} tone="error" label={`The chain read failed: ${error}`} />
      ) : nothing ? (
        <ChartPlaceholder height={HEIGHT} label="No job has settled yet" />
      ) : (
        <div style={{ height: HEIGHT }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }} barCategoryGap="26%">
              <CartesianGrid stroke={chartColors.fog} horizontal={false} />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                width={112}
                tick={{ fill: chartColors.graphite, fontSize: 12, fontFamily: chartFont }}
              />
              <Tooltip cursor={{ fill: chartColors.mist }} content={<FeeTooltip token={token} />} />
              <Bar dataKey="value" radius={[7, 7, 7, 7]} barSize={12} isAnimationActive={false}>
                {rows.map((row) => (
                  <Cell key={row.key} fill={row.color} />
                ))}
                <LabelList
                  dataKey="value"
                  position="right"
                  offset={8}
                  formatter={(value) => `${formatCompactAmount(Number(value))} ${token}`}
                  style={{ fill: chartColors.carbon, fontSize: 12, fontFamily: chartFont }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartFrame>
  );
}
