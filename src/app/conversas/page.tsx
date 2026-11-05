import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ConversationCenter } from "@/modules/conversas/components/conversation-center";

export default function ConversasPage() {
  return (
    <AppShell title="Conversas">
      <Suspense fallback={<p role="status">Carregando conversas...</p>}><ConversationCenter /></Suspense>
    </AppShell>
  );
}
