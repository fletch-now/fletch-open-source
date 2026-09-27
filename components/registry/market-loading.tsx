import type { ReactElement } from "react";
import { RegistryPageIntro } from "./page-intro";
import { LoadingNotice } from "@/components/ui/loading-notice";

export function MarketLoading(): ReactElement {
  return <div className="flex flex-1 flex-col"><main className="w-full px-4 py-6 sm:px-6 lg:px-8">
    <RegistryPageIntro title="Token markets">Prices, trading activity and source ages.</RegistryPageIntro>
    <div className="grid min-h-80 place-items-center py-6"><LoadingNotice title="Loading market readings" registry /></div>
  </main></div>;
}
