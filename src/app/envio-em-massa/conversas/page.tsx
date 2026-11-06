import { AppShell } from "@/components/layout/app-shell";
import { DispatchNavigation } from "@/modules/envio-em-massa/components/dispatch-navigation";
import { DispatchConversations } from "@/modules/envio-em-massa/components/dispatch-conversations";
export default function DispatchInboxPage(){return <AppShell title="Conversas de Disparo"><DispatchNavigation/><DispatchConversations/></AppShell>;}
