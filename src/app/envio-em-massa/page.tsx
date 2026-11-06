import { DispatchNavigation } from "@/modules/envio-em-massa/components/dispatch-navigation";
import { AppShell } from "@/components/layout/app-shell";
import { MassMessagePanel } from "@/modules/envio-em-massa/components/mass-message-panel";

export default function EnvioEmMassaPage() {
  return (
    <AppShell title="Disparos">
      <DispatchNavigation /><MassMessagePanel />
    </AppShell>
  );
}
