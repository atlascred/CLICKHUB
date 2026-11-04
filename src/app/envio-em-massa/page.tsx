import { AppShell } from "@/components/layout/app-shell";
import { MassMessagePanel } from "@/modules/envio-em-massa/components/mass-message-panel";

export default function EnvioEmMassaPage() {
  return (
    <AppShell title="WhatsApp Oficial">
      <MassMessagePanel />
    </AppShell>
  );
}
