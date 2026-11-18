import type { BankConnections } from "../../contracts";
import { BankConnectionsPanel } from "../components/BankConnectionsPanel";
import { PageHeading } from "../components/common";
import type { Page } from "../types";

/** Bank connections (Meu Pluggy / Pluggy): link, sync and disconnect. Cartões stays cards-only. */
export default function OpenFinance({
  connections,
  onImported,
  showNotice,
  navigate,
}: {
  connections?: BankConnections;
  onImported: () => Promise<void>;
  showNotice: (message: string, kind?: "success" | "error") => void;
  navigate: (page: Page) => void;
}) {
  return (
    <>
      <PageHeading title="Open Finance" description="Compras e movimentações dos seus bancos entram sozinhas." />
      <BankConnectionsPanel
        connections={connections}
        onImported={onImported}
        showNotice={showNotice}
        onOpenHelp={() => navigate("profile")}
      />
    </>
  );
}
