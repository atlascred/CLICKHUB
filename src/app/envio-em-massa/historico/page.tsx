import { AppShell } from "@/components/layout/app-shell";
import { DispatchNavigation } from "@/modules/envio-em-massa/components/dispatch-navigation";
import { CampaignHistoryPanel } from "@/modules/envio-em-massa/components/campaign-history-panel";
export default function DispatchHistoryPage(){return <AppShell title="Histórico de Disparos"><DispatchNavigation/><CampaignHistoryPanel/></AppShell>;}
