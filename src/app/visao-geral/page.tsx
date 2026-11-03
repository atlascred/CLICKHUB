import { AppShell } from "@/components/layout/app-shell";
import { OverviewPanel } from "@/modules/visao-geral/components/overview-panel";

export default function OverviewPage() {
  return (
    <AppShell title="Visão Geral">
      <OverviewPanel />
    </AppShell>
  );
}
