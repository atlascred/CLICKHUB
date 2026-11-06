"use client";
import { businessDate } from "@/lib/business-date";
import { fetchApi, apiErrorMessage, reportApiError } from "@/lib/client-api";
import { leadOperatorLabels, leadOriginText } from "@/modules/leads/types/lead-source";
import { buildLeadCopyText, type LeadCopyKind } from "@/modules/leads/clipboard";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, GripVertical, SlidersHorizontal, CalendarClock, Check, FileSearch, Download, Eye, FileUp, LayoutGrid, List, MessageCircle, MessageSquareText, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppDialog } from "@/components/ui/app-dialog";
import { ActionMenu } from "@/components/ui/action-menu";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useApiResource } from "@/hooks/use-api-resource";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { ApiResult } from "@/types/api";

const statusOptions = [
  { value: "NEW", label: "Novo" },
  { value: "CONTACTED", label: "Contato" },
  { value: "QUALIFIED", label: "Qualificado" },
  { value: "PROPOSAL", label: "Proposta" },
  { value: "WON", label: "Fechado" },
  { value: "LOST", label: "Perdido" },
] as const;

const statusMap = Object.fromEntries(statusOptions.map((status) => [status.value, status.label]));

type LeadStatus = (typeof statusOptions)[number]["value"];

type UserOption = {
  id: string;
  name: string;
  email: string;
};

type PlanOption = {
  id: string;
  name: string;
  speed: string;
  price: string | number;
  active: boolean;
};

type LeadStage = {
  id: string;
  name: string;
  status: LeadStatus;
  order: number;
};

type LeadListItem = {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  email: string | null;
  motherName?: string | null;
  cpfCnpj: string | null;
  birthDate: string | null;
  cep: string | null;
  address: string | null;
  streetNumber: string | null;
  complement: string | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  status: LeadStatus;
  kanbanStageId: string | null;
  source: string;
  operatorInstances?: string[];
  notes: string | null;
  expectedValue: string | number | null;
  planName: string | null;
  planValue: string | number | null;
  billingDueDay: number | null;
  assignedUserId: string | null;
  planId: string | null;
  createdAt?: string;
  assignedUser?: UserOption | null;
  plan?: PlanOption | null;
  kanbanStage?: LeadStage | null;
};

type LeadDetail = LeadListItem & {
  createdAt: string;
  updatedAt: string;
  appointments: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    startsAt: string | null;
    dueAt: string | null;
    responsible: UserOption | null;
  }>;
  conversations: Array<{
    id: string;
    phone: string;
    state: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      direction: string;
      body: string;
      createdAt: string;
    }>;
  }>;
};

type ViewMode = "kanban" | "table";
type AgentScope = "both" | "click" | "giga";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const LEADS_PER_PAGE = 25;

export function LeadBoard() {
  const searchParams = useSearchParams();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const { data: currentUser } = useCurrentUser();
  const [agentScope, setAgentScope] = useState<AgentScope>("both");
  const { data, loading, error, refresh, setData: setLeads } = useApiResource<LeadListItem[]>(`/api/leads?agent=${agentScope}`);
  const users = useApiResource<UserOption[]>("/api/users");
  const plans = useApiResource<PlanOption[]>("/api/plans");
  const stages = useApiResource<LeadStage[]>("/api/lead-stages");
  const [query, setQuery] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [saving, setSaving] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const pendingUpdates = useRef(new Map<string, Promise<void>>());
  const orderingStages = useRef(false);
  const [savingStageOrder, setSavingStageOrder] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [page, setPage] = useState(1);

  const activePlans = useMemo(() => (plans.data ?? []).filter((plan) => plan.active), [plans.data]);
  const kanbanStages = useMemo(() => {
    if (stages.data?.length) {
      return stages.data;
    }
    return statusOptions.map((status, index) => ({
      id: status.value,
      name: status.label,
      status: status.value,
      order: (index + 1) * 10,
    }));
  }, [stages.data]);

  const filtered = useMemo(() => {
    const term = query.toLowerCase();
    const createdFilter = searchParams.get("created");
    const today = businessDate();

    return (data ?? []).filter((lead) =>
      (!statusFilter || lead.status === statusFilter || lead.kanbanStageId === statusFilter) &&
      (!createdFilter || createdFilter !== "today" || Boolean(lead.createdAt && businessDate(lead.createdAt) === today)) &&
      [
        lead.name,
        leadOriginText(lead),
        lead.phone,
        lead.email,
        lead.cpfCnpj,
        lead.cep,
        lead.city,
        lead.state,
        lead.plan?.name,
        lead.assignedUser?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [data, query, searchParams, statusFilter]);

  const totalPipeline = useMemo(
    () => filtered.reduce((sum, lead) => sum + Number(lead.expectedValue ?? 0), 0),
    [filtered],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / LEADS_PER_PAGE));
  const paginatedLeads = useMemo(() => {
    const start = (page - 1) * LEADS_PER_PAGE;
    return filtered.slice(start, start + LEADS_PER_PAGE);
  }, [filtered, page]);

  useEffect(() => {
    setPage(1);
  }, [agentScope, query, statusFilter, searchParams, viewMode]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    try {
    event.preventDefault();
    setSaving(true);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const response = await fetchApi("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        motherName: formData.get("motherName"),
        phone: formData.get("phone"),
        email: formData.get("email"),
        cpfCnpj: formData.get("cpfCnpj"),
        birthDate: formData.get("birthDate"),
        cep: formData.get("cep"),
        address: formData.get("address"),
        streetNumber: formData.get("streetNumber"),
        complement: formData.get("complement"),
        neighborhood: formData.get("neighborhood"),
        city: formData.get("city"),
        state: formData.get("state"),
        planId: formData.get("planId"),
        planName: formData.get("planName"),
        planValue: formData.get("planValue"),
        billingDueDay: formData.get("billingDueDay"),
        assignedUserId: formData.get("assignedUserId"),
        expectedValue: formData.get("expectedValue"),
        notes: formData.get("notes"),
        source: "manual",
      }),
    });
    const result = (await response.json()) as ApiResult<LeadListItem>;
    if (result.status === "success") {
      form.reset();
      setShowCreateModal(false);
      await refresh();
    }
    setSaving(false);

    } catch (error) { reportApiError(error); setUpdateError(apiErrorMessage(error));  } finally { setSaving(false); }
  }

  async function updateLead(id: string, payload: Partial<LeadListItem>) {
    // Serialize edits to the same lead so a slower response cannot undo a later edit.
    const previous = pendingUpdates.current.get(id) ?? Promise.resolve();
    const update = previous.then(async () => {
      setUpdateError(null);
      try {
        const response = await fetchApi(`/api/leads/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = (await response.json()) as ApiResult<LeadListItem>;
        if (!response.ok || result.status !== "success" || result.data?.id !== id) {
          throw new Error(result.message || "Não foi possível atualizar o lead.");
        }
        const remainsAssigned = currentUser?.role !== "EMPLOYEE" || result.data.assignedUserId === currentUser.id;
        setLeads((current) => current?.filter((lead) => lead.id !== id || remainsAssigned).map((lead) => lead.id === id ? { ...lead, ...result.data } : lead) ?? null);
        setDetail((current) => current?.id === id ? remainsAssigned ? { ...current, ...result.data } : null : current);
        window.dispatchEvent(new Event("crm:dashboard-refresh"));
      } catch (error) {
        setUpdateError(error instanceof Error ? error.message : "Não foi possível atualizar o lead.");
      }
    });
    pendingUpdates.current.set(id, update);
    await update;
    if (pendingUpdates.current.get(id) === update) pendingUpdates.current.delete(id);
  }

  async function refreshAll() {
    await Promise.all([refresh(), users.refresh(), plans.refresh(), stages.refresh()]);
  }

  async function createStage() {
    try {
    const name = newStageName.trim();
    if (!name) return;
    const response = await fetchApi("/api/lead-stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (response.ok) {
      setNewStageName("");
      await stages.refresh();
    }

    } catch (error) { reportApiError(error); setUpdateError(apiErrorMessage(error));  }
  }

  async function updateStage(id: string, name: string) {
    try {
    const cleanName = name.trim();
    if (!cleanName) return;
    const response = await fetchApi(`/api/lead-stages/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cleanName }),
    });
    if (response.ok) {
      await stages.refresh();
    }

    } catch(error) { reportApiError(error); setUpdateError(apiErrorMessage(error)); }
  }

  function revealStage(id: string) {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    requestAnimationFrame(() => {
      const column = document.querySelector<HTMLElement>(`[data-kanban-stage="${CSS.escape(id)}"]`);
      const board = column?.parentElement;
      if (column && board) board.scrollTo({ left: board.scrollLeft + column.getBoundingClientRect().left - board.getBoundingClientRect().left, behavior: "smooth" });
    });
  }

  async function reorderStages(sourceId: string, targetId: string) {
    const previous = stages.data;
    if (orderingStages.current || !previous || sourceId === targetId) return;
    const sourceIndex = previous.findIndex(stage => stage.id === sourceId);
    const targetIndex = previous.findIndex(stage => stage.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...previous];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    orderingStages.current = true;
    setSavingStageOrder(true);
    setUpdateError(null);
    stages.setData(next);
    try {
      const response = await fetchApi("/api/lead-stages/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.map(stage => stage.id) }),
      });
      const result = (await response.json()) as ApiResult<LeadStage[]>;
      if (!response.ok || result.status !== "success" || !Array.isArray(result.data)) throw new Error(result.message || "Não foi possível salvar a ordem das categorias.");
      stages.setData(result.data);
      revealStage(sourceId);
    } catch (error) {
      stages.setData(previous);
      revealStage(sourceId);
      setUpdateError(error instanceof Error ? error.message : "Não foi possível salvar a ordem das categorias.");
    } finally {
      orderingStages.current = false;
      setSavingStageOrder(false);
    }
  }

  async function deleteStage(id: string) {
    try {
    const response = await fetchApi(`/api/lead-stages/${id}`, { method: "DELETE" });
    if (response.ok) {
      await Promise.all([stages.refresh(), refresh()]);
    }

    } catch(error) { reportApiError(error); setUpdateError(apiErrorMessage(error)); }
  }

  async function saveLeadDetails(id: string, payload: Partial<LeadListItem>) {
    await updateLead(id, payload);
    await openLeadDetails(id);
  }

  async function deleteLead(id: string) {
    try {
    await fetchApi(`/api/leads/${id}`, { method: "DELETE" });
    if (detail?.id === id) {
      setDetail(null);
    }
    await refresh();

    } catch(error) { reportApiError(error); setUpdateError(apiErrorMessage(error)); }
  }

  async function openLeadDetails(id: string) {
    try {
    setDetailLoading(true);
    const response = await fetchApi(`/api/leads/${id}`);
    const result = (await response.json()) as ApiResult<LeadDetail>;
    if (result.status === "success") {
      setDetail(result.data);
    }
    setDetailLoading(false);

    } catch(error) { reportApiError(error); setUpdateError(apiErrorMessage(error)); } finally { setDetailLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="sticky top-14 z-20 -mx-4 space-y-3 border-b border-border/60 bg-background/95 px-4 pb-3 pt-1 backdrop-blur-xl md:hidden">
          <div className="flex items-center gap-2"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Pesquisar leads" className="h-12 rounded-2xl bg-card pl-10" placeholder="Buscar leads" value={query} onChange={event => setQuery(event.target.value)} /></div><Button type="button" variant="outline" size="icon" className={`h-12 w-12 shrink-0 rounded-2xl ${statusFilter || agentScope !== "both" ? "border-primary/30 bg-primary/10 text-primary" : ""}`} aria-label="Filtrar leads" onClick={() => setMobileFiltersOpen(true)}><SlidersHorizontal className="h-5 w-5" /></Button><ActionMenu label="Opções dos leads" className="h-12 w-12 rounded-2xl" items={[
            { label: "Novo lead", icon: <Plus className="h-4 w-4" />, onSelect: () => setShowCreateModal(true) },
            { label: "Atualizar leads", icon: <RefreshCw className="h-4 w-4" />, onSelect: () => void refreshAll() },
            { label: "Exportar planilha", icon: <Download className="h-4 w-4" />, href: `/api/leads/export?agent=${agentScope}` },
          ]} /></div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"><button type="button" aria-label="Visualizar tabela" aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")} className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${viewMode === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><List className="h-4 w-4" />Lista</button><button type="button" aria-label="Visualizar kanban" aria-pressed={viewMode === "kanban"} onClick={() => setViewMode("kanban")} className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${viewMode === "kanban" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><LayoutGrid className="h-4 w-4" />Kanban</button></div>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground md:hidden"><span><strong className="text-foreground">{filtered.length}</strong> leads {statusFilter || query ? "encontrados" : "cadastrados"}</span><span><strong className="text-foreground">{filtered.filter(lead => lead.status === "WON").length}</strong> fechados</span><span className="truncate font-semibold text-foreground">{currencyFormatter.format(totalPipeline)}</span></div>
        <BottomSheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen} title="Filtrar leads"><div className="space-y-5"><label className="grid gap-2 text-sm font-medium">Status ou categoria<select aria-label="Status dos leads" className="h-12 w-full rounded-xl border bg-background px-3" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">Todos os status</option><optgroup label="Status">{statusOptions.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</optgroup><optgroup label="Categorias">{kanbanStages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</optgroup></select></label>
          {currentUser?.role === "ADMIN" && !currentUser.permissions["leads.onlyGiga"] && !currentUser.permissions["leads.onlyClick"] ? <label className="grid gap-2 text-sm font-medium">Origem do atendimento<select aria-label="Chatbot exibido" className="h-12 w-full rounded-xl border bg-background px-3" value={agentScope} onChange={event => setAgentScope(event.target.value as AgentScope)}><option value="both">NIO FIBRA e VIVO FIBRA</option><option value="click">NIO FIBRA</option><option value="giga">VIVO FIBRA</option></select></label> : null}
          <div className="grid grid-cols-2 gap-3 pt-2"><Button type="button" variant="outline" className="h-12 rounded-xl" onClick={() => { setStatusFilter(""); setAgentScope("both"); }}>Limpar filtros</Button><Button type="button" className="h-12 rounded-xl" onClick={() => setMobileFiltersOpen(false)}>Ver leads</Button></div></div></BottomSheet>
        <div className="hidden gap-3 md:grid md:grid-cols-[auto_1fr_auto_auto_auto]">
          <Button type="button" onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Cadastrar Lead Avulso
          </Button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Pesquisar por nome, WhatsApp, CEP, plano ou responsavel"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">Todos os status</option>
            {statusOptions.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
            {kanbanStages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
          {currentUser?.role === "ADMIN" && !currentUser.permissions["leads.onlyGiga"] && !currentUser.permissions["leads.onlyClick"] ? (
            <select aria-label="Chatbot exibido" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={agentScope} onChange={(event) => setAgentScope(event.target.value as AgentScope)}>
              <option value="both">NIO FIBRA e VIVO FIBRA</option>
              <option value="click">NIO FIBRA</option>
              <option value="giga">VIVO FIBRA</option>
            </select>
          ) : null}
          <div className="flex rounded-md border bg-background p-1">
            <Button
              aria-label="Visualizar kanban"
              size="sm"
              type="button"
              variant={viewMode === "kanban" ? "secondary" : "ghost"}
              onClick={() => setViewMode("kanban")}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              aria-label="Visualizar tabela"
              size="sm"
              type="button"
              variant={viewMode === "table" ? "secondary" : "ghost"}
              onClick={() => setViewMode("table")}
            >
              <List className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <Button variant="outline" type="button" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Atualizar
          </Button>
          <Button asChild variant="outline" type="button">
            <a href={`/api/leads/export?agent=${agentScope}`}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Exportar XLSX
            </a>
          </Button>
        </div>

        <div className="hidden gap-3 md:grid md:grid-cols-3">
          <Metric label="Total de Leads Cadastrados" value={(data?.length ?? 0).toString()} />
          <Metric label="Pipeline estimado" value={currencyFormatter.format(totalPipeline)} />
          <Metric label="Fechados" value={filtered.filter((lead) => lead.status === "WON").length.toString()} />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {updateError ? <p role="alert" className="text-sm text-destructive">{updateError}</p> : null}
        {users.error || plans.error ? (
          <p className="text-sm text-muted-foreground">Algumas opcoes auxiliares nao foram carregadas.</p>
        ) : null}

        {viewMode === "kanban" ? (
          <KanbanView
            isMobile={isMobile}
            leads={filtered}
            loading={loading}
            users={users.data ?? []}
            plans={activePlans}
            stages={kanbanStages}
            canReorder={Boolean(stages.data?.length && (currentUser?.role === "ADMIN" || currentUser?.permissions["leads:edit"]))}
            savingOrder={savingStageOrder}
            onReorder={reorderStages}
            newStageName={newStageName}
            onNewStageNameChange={setNewStageName}
            onCreateStage={createStage}
            onUpdateStage={updateStage}
            onDeleteStage={deleteStage}
            onUpdate={updateLead}
            onDelete={deleteLead}
            onOpenDetails={openLeadDetails}
          />
        ) : (
          <div className="space-y-3">
            <TableView
              isMobile={isMobile}
              leads={paginatedLeads}
              loading={loading}
              users={users.data ?? []}
              plans={activePlans}
              stages={kanbanStages}
              onUpdate={updateLead}
              onDelete={deleteLead}
              onOpenDetails={openLeadDetails}
            />
            <PaginationControls
              page={page}
              totalPages={totalPages}
              totalItems={filtered.length}
              itemsPerPage={LEADS_PER_PAGE}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
      <LeadCreateModal
        open={showCreateModal}
        saving={saving}
        users={users.data ?? []}
        plans={activePlans}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleSubmit}
      />
      <LeadDetailPanel
        lead={detail}
        loading={detailLoading}
        users={users.data ?? []}
        plans={activePlans}
        stages={kanbanStages}
        onClose={() => setDetail(null)}
        onSave={saveLeadDetails}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function KanbanView({
  isMobile,
  leads,
  loading,
  users,
  plans,
  stages,
  canReorder,
  savingOrder,
  onReorder,
  newStageName,
  onNewStageNameChange,
  onCreateStage,
  onUpdateStage,
  onDeleteStage,
  onUpdate,
  onDelete,
  onOpenDetails,
}: {
  isMobile: boolean;
  leads: LeadListItem[];
  loading: boolean;
  users: UserOption[];
  plans: PlanOption[];
  stages: LeadStage[];
  canReorder: boolean;
  savingOrder: boolean;
  onReorder: (sourceId: string, targetId: string) => Promise<void>;
  newStageName: string;
  onNewStageNameChange: (value: string) => void;
  onCreateStage: () => Promise<void>;
  onUpdateStage: (id: string, name: string) => Promise<void>;
  onDeleteStage: (id: string) => Promise<void>;
  onUpdate: (id: string, payload: Partial<LeadListItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenDetails: (id: string) => Promise<void>;
}) {
  const [showCreateStage, setShowCreateStage] = useState(false);
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between md:hidden"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categorias</p>{canReorder ? <Button type="button" variant="ghost" size="sm" className="h-10" onClick={() => setShowCreateStage(!showCreateStage)}><Plus className="h-4 w-4" />{showCreateStage ? "Fechar" : "Nova categoria"}</Button> : null}</div>
      <div className={`${showCreateStage ? "flex" : "hidden"} flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row md:flex`}>
        <Input
          placeholder="Nova etapa do Kanban"
          value={newStageName}
          onChange={(event) => onNewStageNameChange(event.target.value)}
        />
        <Button type="button" variant="outline" onClick={onCreateStage}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Criar Etapa
        </Button>
      </div>
      <div role="region" aria-label="Etapas do Kanban de leads" tabIndex={0} className="flex w-full max-w-full snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-3 md:snap-none">
      {stages.map((column, index) => {
        const columnLeads = leads.filter((lead) =>
          lead.kanbanStageId ? lead.kanbanStageId === column.id : lead.status === column.status,
        );
        return (
          <Card
            key={column.id}
            data-kanban-stage={column.id}
            className="flex snap-start h-[calc(100dvh-22rem)] min-h-80 md:h-[calc(100dvh-24rem)] w-[85vw] max-w-[22rem] shrink-0 flex-col sm:w-[22rem]"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const stageId = event.dataTransfer.getData("application/x-clickhub-stage");
              if (stageId) {
                if (canReorder && !savingOrder) void onReorder(stageId, column.id);
                return;
              }
              const leadId = event.dataTransfer.getData("text/plain");
              if (leadId && !leadId.startsWith("stage:")) void onUpdate(leadId, { kanbanStageId: column.id });
            }}
          >
            <CardHeader className="shrink-0 p-4">
              <StageHeader
                stage={column}
                canReorder={canReorder}
                savingOrder={savingOrder}
                previousStageId={stages[index - 1]?.id}
                nextStageId={stages[index + 1]?.id}
                onReorder={onReorder}
                count={columnLeads.length}
                onUpdateStage={onUpdateStage}
                onDeleteStage={onDeleteStage}
              />
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain p-4 pt-0">
              {loading ? (
                <EmptyState text="Carregando" />
              ) : columnLeads.length ? (
                columnLeads.slice(0, isMobile ? visibleCounts[column.id] ?? 30 : columnLeads.length).map((lead) => (
                  <LeadCard
                    key={lead.id}
                    isMobile={isMobile}
                    lead={lead}
                    users={users}
                    plans={plans}
                    stages={stages}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    onOpenDetails={onOpenDetails}
                  />
                ))
              ) : (
                <EmptyState text="Sem leads" />
              )}
              {isMobile && columnLeads.length > (visibleCounts[column.id] ?? 30) ? <Button type="button" variant="outline" className="h-11 w-full rounded-xl" onClick={() => setVisibleCounts(current => ({ ...current, [column.id]: (current[column.id] ?? 30) + 30 }))}>Mostrar mais leads</Button> : null}
            </CardContent>
          </Card>
        );
      })}
      </div>
    </div>
  );
}

function StageHeader({
  stage,
  count,
  canReorder,
  savingOrder,
  previousStageId,
  nextStageId,
  onReorder,
  onUpdateStage,
  onDeleteStage,
}: {
  stage: LeadStage;
  count: number;
  canReorder: boolean;
  savingOrder: boolean;
  previousStageId?: string;
  nextStageId?: string;
  onReorder: (sourceId: string, targetId: string) => Promise<void>;
  onUpdateStage: (id: string, name: string) => Promise<void>;
  onDeleteStage: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);

  async function save() {
    await onUpdateStage(stage.id, name);
    setEditing(false);
  }

  return (
    <CardTitle className="flex items-center justify-between gap-2 text-sm">
      {canReorder ? <button
        type="button"
        draggable={!savingOrder}
        disabled={savingOrder}
        aria-label={`Arrastar categoria ${stage.name}`}
        title="Arraste para organizar as categorias"
        className="hidden shrink-0 cursor-grab md:inline-flex rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing disabled:opacity-40"
        onDragStart={event => {
          event.stopPropagation();
          event.dataTransfer.setData("application/x-clickhub-stage", stage.id);
          event.dataTransfer.setData("text/plain", `stage:${stage.id}`);
          event.dataTransfer.effectAllowed = "move";
        }}
      ><GripVertical className="h-4 w-4" aria-hidden="true" /></button> : null}
      {editing ? (
        <Input className="h-8 min-w-0" value={name} onChange={(event) => setName(event.target.value)} />
      ) : (
        <span className="min-w-0 flex-1 truncate">{stage.name}</span>
      )}
      <div className="hidden shrink-0 items-center gap-1 md:flex">
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
        {canReorder ? <>
          <Button aria-label={`Mover categoria ${stage.name} para a esquerda`} title="Mover categoria para a esquerda" className="h-7 w-7 p-0" size="sm" variant="ghost" type="button" disabled={savingOrder || !previousStageId} onClick={() => previousStageId && void onReorder(stage.id, previousStageId)}><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          <Button aria-label={`Mover categoria ${stage.name} para a direita`} title="Mover categoria para a direita" className="h-7 w-7 p-0" size="sm" variant="ghost" type="button" disabled={savingOrder || !nextStageId} onClick={() => nextStageId && void onReorder(stage.id, nextStageId)}><ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Button>
        </> : null}
        {editing ? (
          <Button aria-label="Salvar etapa" className="h-7 w-7 p-0" size="sm" variant="ghost" type="button" onClick={save}>
            <Check className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button aria-label="Editar etapa" className="h-7 w-7 p-0" size="sm" variant="ghost" type="button" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        <Button aria-label="Excluir etapa" className="h-7 w-7 p-0" size="sm" variant="ghost" type="button" onClick={() => onDeleteStage(stage.id)}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex shrink-0 items-center gap-1 md:hidden"><span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{count}</span>{canReorder ? editing ? <Button type="button" variant="ghost" size="icon" aria-label="Salvar etapa" onClick={() => void save()}><Check className="h-4 w-4" /></Button> : <ActionMenu className="border-0 bg-transparent" label={`Opções da categoria ${stage.name}`} items={[
        { label: "Mover para a esquerda", icon: <ArrowLeft className="h-4 w-4" />, disabled: savingOrder || !previousStageId, onSelect: () => previousStageId && void onReorder(stage.id, previousStageId) },
        { label: "Mover para a direita", icon: <ArrowRight className="h-4 w-4" />, disabled: savingOrder || !nextStageId, onSelect: () => nextStageId && void onReorder(stage.id, nextStageId) },
        { label: "Renomear categoria", icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(true) },
        { label: "Excluir categoria", icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => void onDeleteStage(stage.id) },
      ]} /> : null}</div>
    </CardTitle>
  );
}

function LeadOriginBadge({ lead }: { lead: LeadListItem }) {
  const labels = leadOperatorLabels(lead);
  return <span aria-label="Origem do lead" className="inline-flex flex-wrap gap-1.5">{(labels.length ? labels : [leadOriginText(lead)]).map(label => <span key={label} className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${label === "VIVO FIBRA" ? "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200" : label === "NIO FIBRA" ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200" : "border-border bg-muted text-muted-foreground"}`}>{label}</span>)}</span>;
}

function MobileLeadCard({ lead, stages, onUpdate, onDelete, onOpenDetails }: {
  lead: LeadListItem;
  stages: LeadStage[];
  onUpdate: (id: string, payload: Partial<LeadListItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenDetails: (id: string) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState<{ text: string; success: boolean } | null>(null);
  useEffect(() => { if (!feedback) return; const timer = window.setTimeout(() => setFeedback(null), 3000); return () => window.clearTimeout(timer); }, [feedback]);
  async function copy(kind: LeadCopyKind) {
    try { await navigator.clipboard.writeText(buildLeadCopyText(lead, kind)); setFeedback({ text: kind === "consulta" ? "Consulta copiada." : "Dados da venda copiados.", success: true }); }
    catch { setFeedback({ text: "Não foi possível copiar. Confira a permissão da área de transferência.", success: false }); }
  }
  const router = useRouter();
  const conversationHref = `/conversas?lead=${encodeURIComponent(lead.id)}`;
  return <article data-mobile-lead={lead.id} className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
    <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-sm font-bold text-primary">{lead.name.slice(0, 1).toUpperCase()}</span><button type="button" className="min-w-0 flex-1 py-0.5 text-left" aria-label={`Abrir lead ${lead.name}`} onClick={() => void onOpenDetails(lead.id)}><span className="block truncate text-sm font-bold">{lead.name}</span><span className="mt-1 block text-xs tabular-nums text-muted-foreground">{lead.phone}</span></button><ActionMenu className="-mr-1 -mt-1 border-0 bg-transparent" label={`Ações de ${lead.name}`} items={[
      { label: "Ver detalhes e editar", icon: <Eye className="h-4 w-4" />, onSelect: () => void onOpenDetails(lead.id) },
      { label: "Abrir em Conversas", icon: <MessageCircle className="h-4 w-4 text-emerald-600" />, onSelect: () => router.push(conversationHref) },
      { label: "Copiar CONSULTA", icon: <FileSearch className="h-4 w-4 text-amber-600" />, onSelect: () => void copy("consulta") },
      { label: "Copiar SUBIR VENDA", icon: <FileUp className="h-4 w-4 text-emerald-600" />, onSelect: () => void copy("venda") },
      { label: "Excluir lead", icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => void onDelete(lead.id) },
    ]} /></div>
    <div className="mt-2"><LeadOriginBadge lead={lead} /></div>
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="max-w-full truncate font-medium text-foreground">{lead.planName ?? lead.plan?.name ?? "Sem plano definido"}</span><span className="truncate">{[lead.city, lead.state].filter(Boolean).join(" / ") || "Sem localização"}</span></div>
    <div className="mt-3 flex items-center gap-3 border-t border-border/60 pt-3"><div className="min-w-0 flex-1"><StageSelect ariaLabel={`Etapa de ${lead.name}`} className="h-11 rounded-xl bg-muted/40 text-sm" value={lead.kanbanStageId ?? ""} stages={stages} fallbackStatus={lead.status} onChange={kanbanStageId => void onUpdate(lead.id, { kanbanStageId })} /></div><span className="shrink-0 text-xs font-bold tabular-nums">{currencyFormatter.format(Number(lead.expectedValue ?? 0))}</span></div>
    {feedback ? <p role={feedback.success ? "status" : "alert"} className={`mt-2 text-xs ${feedback.success ? "text-emerald-600" : "text-destructive"}`}>{feedback.text}</p> : null}
  </article>;
}

function TableView({
  isMobile,
  leads,
  loading,
  users,
  plans,
  stages,
  onUpdate,
  onDelete,
  onOpenDetails,
}: {
  isMobile: boolean;
  leads: LeadListItem[];
  loading: boolean;
  users: UserOption[];
  plans: PlanOption[];
  stages: LeadStage[];
  onUpdate: (id: string, payload: Partial<LeadListItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenDetails: (id: string) => Promise<void>;
}) {
  if (loading) {
    return <EmptyState text="Carregando leads" />;
  }

  if (isMobile) return <div className="space-y-3">{leads.length ? leads.map(lead => <MobileLeadCard key={lead.id} lead={lead} stages={stages} onUpdate={onUpdate} onDelete={onDelete} onOpenDetails={onOpenDetails} />) : <EmptyState text="Nenhum lead encontrado" />}</div>;
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium">Nome do cliente</th>
              <th className="px-3 py-3 font-medium">Contato</th>
              <th className="px-3 py-3 font-medium">Cidade</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Plano</th>
              <th className="px-3 py-3 font-medium">Atribuido</th>
              <th className="px-3 py-3 font-medium">Data</th>
              <th className="px-3 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {leads.length ? (
              leads.map((lead) => (
                <tr key={lead.id}>
                  <td className="px-3 py-3">
                    <p className="font-medium">{lead.name}</p>
                    <div className="mt-1"><LeadOriginBadge lead={lead} /></div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{lead.phone}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <p>{[lead.city, lead.state].filter(Boolean).join(" / ") || "Sem cidade"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <StageSelect
                      value={lead.kanbanStageId ?? ""}
                      stages={stages}
                      fallbackStatus={lead.status}
                      onChange={(kanbanStageId) => onUpdate(lead.id, { kanbanStageId })}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <PlanSelect
                      value={lead.planId ?? ""}
                      plans={plans}
                      onChange={(planId) => onUpdate(lead.id, buildPlanPayload(planId, plans))}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <UserSelect
                      value={lead.assignedUserId ?? ""}
                      users={users}
                      onChange={(assignedUserId) => onUpdate(lead.id, { assignedUserId })}
                    />
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {formatDateTime(lead.createdAt)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <LeadConversationButton leadId={lead.id} />
                      <LeadCopyButtons lead={lead} />
                      <Button
                        aria-label="Ver detalhes do lead"
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => onOpenDetails(lead.id)}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        aria-label="Excluir lead"
                        size="sm"
                        variant="destructive"
                        type="button"
                        onClick={() => onDelete(lead.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>
                  Nenhum lead encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaginationControls({
  page,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}) {
  const start = totalItems === 0 ? 0 : (page - 1) * itemsPerPage + 1;
  const end = Math.min(page * itemsPerPage, totalItems);

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-background p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground">
        Mostrando {start}-{end} de {totalItems} leads
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </Button>
        <span className="min-w-24 text-center text-muted-foreground">
          Pagina {page} de {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Proxima
        </Button>
      </div>
    </div>
  );
}

function LeadCard({
  isMobile,
  lead,
  users,
  plans,
  stages,
  onUpdate,
  onDelete,
  onOpenDetails,
}: {
  isMobile: boolean;
  lead: LeadListItem;
  users: UserOption[];
  plans: PlanOption[];
  stages: LeadStage[];
  onUpdate: (id: string, payload: Partial<LeadListItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenDetails: (id: string) => Promise<void>;
}) {
  if (isMobile) return <div draggable onDragStart={event => { event.dataTransfer.setData("text/plain", lead.id); event.dataTransfer.effectAllowed = "move"; }}><MobileLeadCard lead={lead} stages={stages} onUpdate={onUpdate} onDelete={onDelete} onOpenDetails={onOpenDetails} /></div>;
  return (
    <div
      className="rounded-md border bg-background p-3 text-sm"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", lead.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[120px] flex-1">
          <p className="truncate font-medium">{lead.name}</p>
          <LeadOriginBadge lead={lead} />
          <p className="text-muted-foreground">{lead.phone}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <LeadConversationButton leadId={lead.id} compact />
          <LeadCopyButtons lead={lead} />
          <Button
            aria-label="Ver detalhes do lead"
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => onOpenDetails(lead.id)}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            aria-label="Excluir lead"
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => onDelete(lead.id)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <p>{lead.planName ?? lead.plan?.name ?? "Sem plano definido"}</p>
        <p>{lead.assignedUser?.name ?? "Sem responsavel"}</p>
        <p>{[lead.city, lead.state].filter(Boolean).join(" / ") || lead.cep || "Sem localizacao"}</p>
        <p>{currencyFormatter.format(Number(lead.expectedValue ?? 0))}</p>
      </div>
      <div className="mt-3 space-y-2">
        <StageSelect
          value={lead.kanbanStageId ?? ""}
          stages={stages}
          fallbackStatus={lead.status}
          onChange={(kanbanStageId) => onUpdate(lead.id, { kanbanStageId })}
        />
        <PlanSelect value={lead.planId ?? ""} plans={plans} onChange={(planId) => onUpdate(lead.id, buildPlanPayload(planId, plans))} />
        <UserSelect
          value={lead.assignedUserId ?? ""}
          users={users}
          onChange={(assignedUserId) => onUpdate(lead.id, { assignedUserId })}
        />
      </div>
    </div>
  );
}

function LeadCreateModal({
  open,
  saving,
  users,
  plans,
  onClose,
  onSubmit,
}: {
  open: boolean;
  saving: boolean;
  users: UserOption[];
  plans: PlanOption[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  if (!open) return null;

  return <AppDialog title="Novo Lead" description="Cadastro avulso" onClose={onClose} drawer closeLabel="Fechar cadastro">
        <form className="space-y-4" onSubmit={onSubmit}>
          <LeadFields users={users} plans={plans} />
          <Button className="w-full" disabled={saving} type="submit">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {saving ? "Salvando" : "Cadastrar"}
          </Button>
        </form>
  </AppDialog>;
}

function LeadEditForm({
  lead,
  users,
  plans,
  stages,
  onSave,
}: {
  lead: LeadDetail;
  users: UserOption[];
  plans: PlanOption[];
  stages: LeadStage[];
  onSave: (id: string, payload: Partial<LeadListItem>) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    try {
    event.preventDefault();
    setSaving(true);
    await onSave(lead.id, readLeadForm(new FormData(event.currentTarget)));
    setSaving(false);

    } catch (error) { reportApiError(error);  } finally { setSaving(false); }
  }

  return (
    <section className="rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Dados do Lead</h3>
          <p className="text-xs text-muted-foreground">ID do cliente: {lead.customerCode}</p>
        </div>
        <span className="text-xs text-muted-foreground">Chegou em {formatDateTime(lead.createdAt)}</span>
      </div>
      <form className="mt-4 space-y-4" onSubmit={handleSave}>
        <LeadFields lead={lead} users={users} plans={plans} stages={stages} />
        <Button disabled={saving} type="submit">
          {saving ? "Salvando" : "Salvar Alteracoes"}
        </Button>
      </form>
    </section>
  );
}

function LeadFields({
  lead,
  users,
  plans,
  stages,
}: {
  lead?: Partial<LeadListItem>;
  users: UserOption[];
  plans: PlanOption[];
  stages?: LeadStage[];
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="name" placeholder="Nome completo" defaultValue={lead?.name ?? ""} required />
        <Input name="phone" placeholder="WhatsApp" defaultValue={lead?.phone ?? ""} required />
        <label className="grid gap-1 text-xs font-medium text-muted-foreground"><span>Nome completo da mãe</span><Input name="motherName" placeholder="Nome completo da mãe" aria-label="Nome completo da mãe" defaultValue={lead?.motherName ?? ""} /></label>
        <Input name="email" placeholder="E-mail" type="text" defaultValue={lead?.email ?? ""} />
        <Input name="cpfCnpj" placeholder="CPF" defaultValue={lead?.cpfCnpj ?? ""} />
        <label className="grid gap-1 text-xs font-medium text-muted-foreground"><span>Data de nascimento</span><Input name="birthDate" placeholder="Data de nascimento" type="date" defaultValue={formatDateInput(lead?.birthDate)} /></label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground"><span>Dia de vencimento</span><Input name="billingDueDay" placeholder="Dia de vencimento" type="number" min="1" max="31" defaultValue={lead?.billingDueDay ?? ""} /></label>
      </div>

      {stages?.length ? (
        <StageSelect
          className="h-10 text-sm"
          value={lead?.kanbanStageId ?? ""}
          stages={stages}
          fallbackStatus={lead?.status}
          name="kanbanStageId"
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="address" placeholder="Nome da rua" defaultValue={lead?.address ?? ""} />
        <Input name="streetNumber" placeholder="Numero" defaultValue={lead?.streetNumber ?? ""} />
        <Input name="complement" placeholder="Complemento" defaultValue={lead?.complement ?? ""} />
        <Input name="neighborhood" placeholder="Bairro" defaultValue={lead?.neighborhood ?? ""} />
        <Input name="city" placeholder="Cidade" defaultValue={lead?.city ?? ""} />
        <Input name="state" placeholder="Estado" maxLength={2} defaultValue={lead?.state ?? ""} />
        <Input name="cep" placeholder="CEP" defaultValue={lead?.cep ?? ""} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <select
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          name="planId"
          defaultValue={lead?.planId ?? ""}
        >
          <option value="">Plano</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name} - {plan.speed}
            </option>
          ))}
        </select>
        <Input name="planName" placeholder="Nome do plano" defaultValue={lead?.planName ?? lead?.plan?.name ?? ""} />
        <Input name="planValue" placeholder="Valor do plano" type="number" min="0" step="0.01" defaultValue={Number(lead?.planValue ?? lead?.expectedValue ?? lead?.plan?.price ?? 0)} />
        <Input name="expectedValue" placeholder="Valor estimado" type="number" min="0" step="0.01" defaultValue={Number(lead?.expectedValue ?? lead?.planValue ?? 0)} />
      </div>

      <select
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        name="assignedUserId"
        defaultValue={lead?.assignedUserId ?? ""}
      >
        <option value="">Funcionario atribuido</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      <Textarea name="notes" placeholder="Observacao" defaultValue={lead?.notes ?? ""} />
    </div>
  );
}

function LeadDetailPanel({
  lead,
  loading,
  users,
  plans,
  stages,
  onClose,
  onSave,
}: {
  lead: LeadDetail | null;
  loading: boolean;
  users: UserOption[];
  plans: PlanOption[];
  stages: LeadStage[];
  onClose: () => void;
  onSave: (id: string, payload: Partial<LeadListItem>) => Promise<void>;
}) {
  if (!lead && !loading) {
    return null;
  }

  return <AppDialog title={lead?.name ?? "Carregando"} description={lead ? `${lead.phone} · ${leadOriginText(lead)}` : "Buscando informações do lead"} onClose={onClose} drawer closeLabel="Fechar detalhes"><div className="space-y-4">
          {loading ? (
            <EmptyState text="Carregando detalhes" />
          ) : lead ? (
            <>
              <LeadEditForm lead={lead} users={users} plans={plans} stages={stages} onSave={onSave} />

              <section className="rounded-md border p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  Compromissos Vinculados
                </h3>
                <div className="mt-3 space-y-2">
                  {lead.appointments.length ? (
                    lead.appointments.map((appointment) => (
                      <div key={appointment.id} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <strong>{appointment.title}</strong>
                          <span className="text-xs text-muted-foreground">{appointment.status}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {appointment.responsible?.name ?? "Sem responsavel"} -{" "}
                          {formatDateTime(appointment.startsAt ?? appointment.dueAt)}
                        </p>
                        {appointment.description ? <p className="mt-2 text-sm">{appointment.description}</p> : null}
                      </div>
                    ))
                  ) : (
                    <EmptyState text="Nenhum compromisso vinculado" />
                  )}
                </div>
              </section>

              <section className="rounded-md border p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                  Conversas do atendimento
                </h3>
                <div className="mt-3 space-y-3">
                  {lead.conversations.length ? (
                    lead.conversations.map((conversation) => (
                      <div key={conversation.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <strong>{conversation.phone}</strong>
                          <span className="text-xs text-muted-foreground">{conversation.state}</span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {conversation.messages.map((message) => (
                            <div key={message.id} className="rounded-md bg-muted p-2 text-sm">
                              <p className="text-xs uppercase text-muted-foreground">
                                {message.direction === "inbound" ? "Cliente" : leadOriginText(lead)} -{" "}
                                {formatDateTime(message.createdAt)}
                              </p>
                              <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState text="Nenhuma conversa vinculada" />
                  )}
                </div>
              </section>
            </>
          ) : null}

  </div></AppDialog>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function StageSelect({
  value,
  stages,
  fallbackStatus,
  name,
  ariaLabel,
  className = "h-8 text-xs",
  onChange,
}: {
  value: string;
  stages: LeadStage[];
  fallbackStatus?: LeadStatus;
  name?: string;
  ariaLabel?: string;
  className?: string;
  onChange?: (value: string) => void;
}) {
  const fallbackStage = !value && fallbackStatus ? stages.find((stage) => stage.status === fallbackStatus) : null;
  const selectedValue = value || fallbackStage?.id || "";
  return (
    <select
      className={`w-full rounded-md border bg-background px-2 ${className}`}
      name={name}
      aria-label={ariaLabel}
      {...(onChange ? { value: selectedValue } : { defaultValue: selectedValue })}
      onChange={(event) => onChange?.(event.target.value)}
    >
      <option value="">Sem etapa</option>
      {stages.map((stage) => (
        <option key={stage.id} value={stage.id}>
          {stage.name}
        </option>
      ))}
    </select>
  );
}

function StatusSelect({ value, onChange }: { value: LeadStatus; onChange: (value: LeadStatus) => void }) {
  return (
    <select
      className="h-8 w-full rounded-md border bg-background px-2 text-xs"
      value={value}
      onChange={(event) => onChange(event.target.value as LeadStatus)}
    >
      {statusOptions.map((status) => (
        <option key={status.value} value={status.value}>
          {statusMap[status.value]}
        </option>
      ))}
    </select>
  );
}

function PlanSelect({
  value,
  plans,
  onChange,
}: {
  value: string;
  plans: PlanOption[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="h-8 w-full rounded-md border bg-background px-2 text-xs"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Sem plano</option>
      {plans.map((plan) => (
        <option key={plan.id} value={plan.id}>
          {plan.name}
        </option>
      ))}
    </select>
  );
}

function UserSelect({
  value,
  users,
  onChange,
}: {
  value: string;
  users: UserOption[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="h-8 w-full rounded-md border bg-background px-2 text-xs"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Sem responsavel</option>
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {user.name}
        </option>
      ))}
    </select>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function LeadCopyButtons({ lead }: { lead: LeadListItem }) {
  const [feedback, setFeedback] = useState<{ kind: LeadCopyKind; success: boolean } | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  async function copy(kind: LeadCopyKind) {
    try {
      await navigator.clipboard.writeText(buildLeadCopyText(lead, kind));
      setFeedback({ kind, success: true });
    } catch {
      setFeedback({ kind, success: false });
    }
  }

  return (
    <div className="relative flex gap-2">
      <Button type="button" size="sm" className="w-9 shrink-0 bg-amber-400 px-0 text-amber-950 hover:bg-amber-500" aria-label="CONSULTA" title="CONSULTA: copiar dados para consulta" onClick={() => void copy("consulta")}>
        {feedback?.kind === "consulta" && feedback.success ? <Check className="h-4 w-4" aria-hidden="true" /> : <FileSearch className="h-4 w-4" aria-hidden="true" />}
      </Button>
      <Button type="button" size="sm" className="w-9 shrink-0 bg-emerald-600 px-0 text-white hover:bg-emerald-700" aria-label="SUBIR VENDA" title="SUBIR VENDA: copiar dados da venda" onClick={() => void copy("venda")}>
        {feedback?.kind === "venda" && feedback.success ? <Check className="h-4 w-4" aria-hidden="true" /> : <FileUp className="h-4 w-4" aria-hidden="true" />}
      </Button>
      {feedback?.success ? <span className="sr-only" role="status">{feedback.kind === "consulta" ? "Consulta copiada." : "Dados da venda copiados."}</span> : null}
      {feedback && !feedback.success ? <span role="alert" className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border bg-background p-2 text-left text-xs text-destructive shadow">Não foi possível copiar. Verifique a permissão da área de transferência.</span> : null}
    </div>
  );
}

function LeadConversationButton({ leadId, compact = false }: { leadId: string; compact?: boolean }) {
  return <Button asChild aria-label="Abrir contato em Conversas" title="Abrir contato em Conversas" size="sm" variant={compact ? "ghost" : "outline"}>
    <Link href={`/conversas?lead=${encodeURIComponent(leadId)}`}><MessageCircle className="h-4 w-4" aria-hidden="true" /></Link>
  </Button>;
}


function formatDateTime(value?: string | null) {
  if (!value) {
    return "Sem data";
  }
  return new Date(value).toLocaleString("pt-BR");
}

function formatDateInput(value?: string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function readLeadForm(formData: FormData): Partial<LeadListItem> {
  return {
    name: String(formData.get("name") ?? ""),
    motherName: String(formData.get("motherName") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    cpfCnpj: String(formData.get("cpfCnpj") ?? ""),
    birthDate: String(formData.get("birthDate") ?? ""),
    cep: String(formData.get("cep") ?? ""),
    address: String(formData.get("address") ?? ""),
    streetNumber: String(formData.get("streetNumber") ?? ""),
    complement: String(formData.get("complement") ?? ""),
    neighborhood: String(formData.get("neighborhood") ?? ""),
    city: String(formData.get("city") ?? ""),
    state: String(formData.get("state") ?? ""),
    kanbanStageId: String(formData.get("kanbanStageId") ?? ""),
    planId: String(formData.get("planId") ?? ""),
    planName: String(formData.get("planName") ?? ""),
    planValue: Number(formData.get("planValue") || 0),
    expectedValue: Number(formData.get("expectedValue") || formData.get("planValue") || 0),
    billingDueDay: Number(formData.get("billingDueDay") || 0) || undefined,
    assignedUserId: String(formData.get("assignedUserId") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

function buildPlanPayload(planId: string, plans: PlanOption[]): Partial<LeadListItem> {
  const plan = plans.find((item) => item.id === planId);
  return {
    planId,
    planName: plan?.name ?? "",
    planValue: plan ? Number(plan.price) : 0,
    expectedValue: plan ? Number(plan.price) : 0,
  };
}
