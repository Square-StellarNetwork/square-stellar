import type { Metadata } from "next";

import { DepositView } from "@/components/views/DepositView";

export const metadata: Metadata = {
  title: "Deposit",
  description: "Put lira in through a Stellar anchor and get a balance you can fund a job with.",
};

export default function DepositPage() {
  return <DepositView />;
}
