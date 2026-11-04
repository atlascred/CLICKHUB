"use client";

import { FormEvent, ReactNode, useMemo, useState } from "react";
import {
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronsUpDown,
  Ellipsis,
  Filter,
  KeyRound,
  Pencil,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { permissions } from "@/constants/permissions";
import { useApiResource } from "@/hooks/use-api-resource";
import { useCurrentUser } from "@/hooks/use-current-user";
import { getLeadAgentScope } from "@/lib/lead-source-access";

type UserItem = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  role: "ADMIN" | "EMPLOYEE";
  status: "ACTIVE" | "BLOCKED";
  permissions: Record<string, boolean> | null;
  lastLoginAt?: string | null;
};

type CategoryKey = "all" | "admin" | "supplier" | "blocked" | "untitled";

const permissionGroups = [
  { title: "Conversas e WhatsApp", access: permissions.conversationsView, items: [[permissions.conversationsView, "Acessar conversas e WhatsApp"]] },
  { title: "Dashboard", access: permissions.dashboardView, items: [[permissions.dashboardView, "Acessar Dashboard"], [permissions.dashboardEdit, "Editar informações"]] },
  { title: "Leads", access: permissions.leadsView, items: [[permissions.leadsView, "Acessar Leads"], [permissions.leadsCreate, "Cadastrar leads"], [permissions.leadsEdit, "Editar leads"], [permissions.leadsDelete, "Excluir leads"], [permissions.leadsMoveKanban, "Mover no Kanban"], [permissions.leadsExport, "Exportar planilha"]] },
  { title: "Compromissos", access: permissions.appointmentsView, items: [[permissions.appointmentsView, "Acessar Compromissos"], [permissions.appointmentsCreate, "Criar compromissos"], [permissions.appointmentsEdit, "Editar compromissos"], [permissions.appointmentsDelete, "Excluir compromissos"]] },
  { title: "Despesas", access: permissions.expensesView, items: [[permissions.expensesView, "Acessar Despesas"], [permissions.expensesEdit, "Cadastrar e editar despesas"], [permissions.expensesDelete, "Excluir despesas"]] },
  { title: "CEPs", access: permissions.cepsView, items: [[permissions.cepsView, "Consultar cobertura de CEPs"]] },
  { title: "N8N", access: permissions.agentsEdit, items: [[permissions.agentsEdit, "Acessar N8N"], [permissions.agentsCreate, "Cadastrar agentes"], [permissions.plansEdit, "Editar planos"], [permissions.openAiEdit, "Configurar OpenAI"], [permissions.zapiEdit, "Configurar Z-API"]] },
  { title: "Configurações", access: permissions.settingsView, items: [[permissions.settingsView, "Acessar Configurações"], [permissions.settingsEdit, "Editar configurações"]] },
] as const;

const PAGE_SIZE = 10;

export function UserManagement() {
  const usersResource = useApiResource<UserItem[]>("/api/users");
  const currentUser = useCurrentUser();
  const [editing, setEditing] = useState<UserItem | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [category, setCategory] = useState<CategoryKey>("all");
  const [page, setPage] = useState(1);

  const users = usersResource.data ?? [];
  const categories = useMemo(() => {
    const adminCount = users.filter((user) => user.role === "ADMIN").length;
    const supplierCount = users.filter((user) => user.role === "EMPLOYEE").length;
    const blockedCount = users.filter((user) => user.status === "BLOCKED").length;
    const untitledCount = users.filter((user) => !user.title?.trim()).length;

    return [
      { key: "all" as const, label: "todos", count: users.length },
      { key: "admin" as const, label: "administrador", count: adminCount },
      { key: "supplier" as const, label: "fornecedor", count: supplierCount },
      { key: "blocked" as const, label: "bloqueado", count: blockedCount },
      { key: "untitled" as const, label: "sem cargo", count: untitledCount },
    ];
  }, [users]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.toLowerCase().trim();

    return users
      .filter((user) => {
        if (category === "admin") return user.role === "ADMIN";
        if (category === "supplier") return user.role === "EMPLOYEE";
        if (category === "blocked") return user.status === "BLOCKED";
        if (category === "untitled") return !user.title?.trim();
        return true;
      })
      .filter((user) => {
        if (!normalizedQuery) return true;
        return `${user.name} ${user.email} ${user.phone ?? ""} ${user.title ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [users, category, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  async function request(id: string | null, payload?: Record<string, unknown>, method = "PUT") {
    setSaving(true);
    setNotice("");
    const response = await fetch(id ? `/api/users/${id}` : "/api/users", {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const result = await response.json();
    setSaving(false);
    setNotice(result.message ?? "Operação concluída.");
    if (!response.ok) return false;
    await usersResource.refresh();
    return true;
  }

  async function save(payload: Record<string, unknown>) {
    const ok = await request(editing?.id ?? null, payload, editing ? "PUT" : "POST");
    if (ok) setEditing(undefined);
  }

  async function toggleBlock(user: UserItem) {
    if (user.id === currentUser.data?.id) return setNotice("Você não pode bloquear a própria conta.");
    await request(user.id, { status: user.status === "ACTIVE" ? "BLOCKED" : "ACTIVE" });
  }

  async function remove(user: UserItem) {
    if (user.id === currentUser.data?.id) return setNotice("Você não pode excluir a própria conta.");
    if (!window.confirm(`Excluir o cadastro ${user.name}?`)) return;
    await request(user.id, undefined, "DELETE");
  }

  function changeCategory(nextCategory: CategoryKey) {
    setCategory(nextCategory);
    setPage(1);
  }

  function changeQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:rounded-[28px] sm:p-6 shadow-[0_20px_70px_rgba(15,23,42,0.08)]">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="hidden items-center gap-2 text-sm text-slate-500 md:flex">
              <span>início</span>
              <span>=</span>
              <span>cadastros</span>
              <span className="font-semibold text-slate-900">clientes e fornecedores</span>
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-950 md:text-3xl">Clientes e Fornecedores</h2>
              <p className="mt-1 hidden text-sm text-slate-500 md:block">Visual unificado de cadastros com foco em fornecedores.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" className="hidden h-11 rounded-full border-slate-200 px-4 text-slate-700 md:inline-flex">
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
            <Button type="button" onClick={() => setEditing(null)} className="h-11 rounded-full bg-blue-600 px-5 text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" />
              Incluir cadastro
            </Button>
            <Button type="button" variant="outline" className="hidden h-11 rounded-full border-slate-200 px-4 text-slate-700 md:inline-flex">
              mais ações
              <Ellipsis className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {notice && <p className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{notice}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 basis-full flex-1 md:min-w-[320px] md:basis-auto">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-12 rounded-2xl border-slate-200 bg-white pl-11 pr-14 text-base shadow-none"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder="Pesquise por nome, cód., fantasia, email ou CPF/CNPJ"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl border border-slate-200 text-slate-500"
              aria-label="Filtros rápidos"
            >
              <Filter className="h-4 w-4" />
            </button>
          </div>
          <ToolbarChip icon={<CalendarDays className="h-4 w-4" />} label="por data do cadastro" />
          <ToolbarChip icon={<ChevronsUpDown className="h-4 w-4" />} label="nome" />
          <ToolbarChip label="por situação" />
          <ToolbarChip icon={<Filter className="h-4 w-4" />} label="filtros" />
        </div>

        <div className="flex flex-nowrap items-end gap-5 overflow-x-auto border-b border-slate-200 pb-4 md:flex-wrap md:gap-8">
          {categories.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => changeCategory(item.key)}
              className={`min-w-[80px] shrink-0 border-b-2 pb-2 text-left transition ${
                category === item.key
                  ? "border-slate-900 text-slate-950"
                  : "border-transparent text-slate-400 hover:text-slate-700"
              }`}
            >
              <span className="block text-[15px] font-medium capitalize">{item.label}</span>
              <span className={`block text-3xl leading-none ${category === item.key ? "text-slate-950" : "text-slate-500"}`}>
                {String(item.count).padStart(2, "0")}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="ml-auto hidden items-center gap-2 rounded-full md:inline-flex border border-slate-200 px-4 py-2 text-sm text-slate-600"
          >
            mais
            <Ellipsis className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-slate-200">
          <div className="overflow-x-auto">
            <table className="crm-mobile-table w-full min-w-[980px] text-left">
              <thead className="bg-slate-50 text-sm text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="w-14 px-4 py-4">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300" />
                  </th>
                  <th className="px-4 py-4 font-medium">Nome</th>
                  <th className="px-4 py-4 font-medium">CPF/CNPJ</th>
                  <th className="px-4 py-4 font-medium">Cidade</th>
                  <th className="px-4 py-4 font-medium">Contato</th>
                  <th className="px-4 py-4 font-medium">Tipo</th>
                  <th className="px-4 py-4 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="bg-white text-[15px] text-slate-800">
                {usersResource.loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-slate-500">Carregando cadastros</td>
                  </tr>
                ) : null}

                {!usersResource.loading && paginated.map((user) => (
                  <tr key={user.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70">
                    <td className="hidden px-4 py-5 align-top md:table-cell">
                      <div className="flex items-center gap-3">
                        <input type="checkbox" className="h-4 w-4 rounded border-slate-300" />
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                          onClick={() => setEditing(user)}
                          aria-label={`Abrir ações de ${user.name}`}
                        >
                          <Ellipsis className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-5 align-top">
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">
                          {user.name}
                          {user.id === currentUser.data?.id ? <span className="ml-2 text-xs text-blue-600">Você</span> : null}
                        </p>
                        <p className="text-sm text-slate-500">{user.title || "Sem cargo informado"}</p>
                      </div>
                    </td>
                    <td data-label="CPF/CNPJ" className="px-4 py-5 align-top text-slate-700">{formatCpfCnpjLike(user.phone, user.email)}</td>
                    <td data-label="Cidade" className="px-4 py-5 align-top text-slate-700">{inferCity(user)}</td>
                    <td data-label="Contato" className="px-4 py-5 align-top">
                      <div className="space-y-1 text-slate-700">
                        <p>{user.email}</p>
                        <p>{user.phone || "Sem telefone"}</p>
                      </div>
                    </td>
                    <td data-label="Tipo" className="px-4 py-5 align-top">
                      <div className="space-y-2">
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          {user.role === "ADMIN" ? "administrador" : "fornecedor"}
                        </span>
                        <div>
                          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                            user.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}>
                            {user.status === "ACTIVE" ? <CheckCircle2 className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                            {user.status === "ACTIVE" ? "ativo" : "bloqueado"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-5 align-top">
                      <div className="flex justify-end gap-2">
                        <IconAction title="Editar cadastro" onClick={() => setEditing(user)}>
                          <Pencil className="h-4 w-4" />
                        </IconAction>
                        <IconAction
                          title={user.status === "ACTIVE" ? "Bloquear cadastro" : "Desbloquear cadastro"}
                          onClick={() => toggleBlock(user)}
                          disabled={user.id === currentUser.data?.id}
                        >
                          {user.status === "ACTIVE" ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                        </IconAction>
                        <IconAction
                          title="Excluir cadastro"
                          onClick={() => remove(user)}
                          disabled={user.id === currentUser.data?.id}
                          destructive
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconAction>
                      </div>
                    </td>
                  </tr>
                ))}

                {!usersResource.loading && !paginated.length ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-slate-500">Nenhum cadastro encontrado</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
            const itemPage = index + 1;
            return (
              <button
                key={itemPage}
                type="button"
                onClick={() => setPage(itemPage)}
                className={`flex h-9 min-w-9 items-center justify-center rounded-full px-3 ${
                  safePage === itemPage ? "bg-slate-900 text-white" : "hover:bg-slate-100"
                }`}
              >
                {String(itemPage).padStart(2, "0")}
              </button>
            );
          })}
          {totalPages > 5 ? <span className="px-1">...</span> : null}
          {totalPages > 5 ? (
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              className={`flex h-9 min-w-9 items-center justify-center rounded-full px-3 ${
                safePage === totalPages ? "bg-slate-900 text-white" : "hover:bg-slate-100"
              }`}
            >
              {String(totalPages).padStart(2, "0")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className="ml-2 flex h-9 items-center justify-center rounded-full px-3 hover:bg-slate-100"
          >
            →
          </button>
        </div>
      </div>

      {editing !== undefined ? (
        <UserModal user={editing} saving={saving} onClose={() => setEditing(undefined)} onSave={save} />
      ) : null}
    </div>
  );
}

function UserModal({ user, saving, onClose, onSave }: { user: UserItem | null; saving: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [role, setRole] = useState<UserItem["role"]>(user?.role ?? "EMPLOYEE");
  const [selected, setSelected] = useState<Record<string, boolean>>(user?.permissions ?? {});

  const toggleGroup = (group: typeof permissionGroups[number], checked: boolean) =>
    setSelected((current) => ({ ...current, ...Object.fromEntries(group.items.map(([key]) => [key, checked])) }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    await onSave({
      name: data.get("name"),
      email: data.get("email"),
      phone: data.get("phone"),
      title: data.get("title"),
      role,
      status: user?.status ?? "ACTIVE",
      permissions: role === "ADMIN" ? {} : selected,
      ...(password ? { password } : {}),
    });
  }

  return (
    <Modal title={user ? `Editar ${user.name}` : "Incluir cadastro"} onClose={onClose}>
      <form className="space-y-5" onSubmit={submit}>
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">Dados do cadastro</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="name" defaultValue={user?.name ?? ""} placeholder="Nome completo" required />
            <Input name="email" defaultValue={user?.email ?? ""} placeholder="E-mail" type="email" required />
            <Input name="phone" defaultValue={user?.phone ?? ""} placeholder="Telefone" />
            <Input name="title" defaultValue={user?.title ?? ""} placeholder="Cargo ou função" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={role}
              onChange={(event) => setRole(event.target.value as UserItem["role"])}
            >
              <option value="EMPLOYEE">Fornecedor/Colaborador</option>
              <option value="ADMIN">Administrador</option>
            </select>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                name="password"
                type="password"
                minLength={8}
                required={!user}
                placeholder={user ? "Nova senha (opcional)" : "Senha inicial"}
              />
            </div>
          </div>
        </fieldset>

        {role === "ADMIN" ? (
          <div className="flex gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Acesso administrativo completo</p>
              <p>Este cadastro poderá acessar todas as abas e funções do sistema.</p>
            </div>
          </div>
        ) : (
          <fieldset>
            <legend className="mb-3 text-sm font-semibold">Abas e permissões do cadastro</legend>
            <fieldset className="mb-4 rounded-md border border-blue-200 bg-blue-50/50 p-4">
              <legend className="px-1 text-sm font-semibold">Leads permitidos por chatbot</legend>
              <div className="flex flex-wrap gap-4">
                {([['click', 'NIO FIBRA'], ['giga', 'VIVO FIBRA'], ['both', 'Ambos']] as const).map(([value, label]) => (
                  <label key={value} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="leadAgentScope" value={value}
                      checked={getLeadAgentScope(selected) === value}
                      onChange={() => setSelected((current) => ({ ...current, 'leads.onlyClick': value === 'click', 'leads.onlyGiga': value === 'giga' }))} />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Aplica-se aos leads atribuídos a este funcionário. Ambos mantém também os cadastros manuais atribuídos.</p>
            </fieldset>
            <div className="grid gap-3 md:grid-cols-2">
              {permissionGroups.map((group) => {
                const all = group.items.every(([key]) => selected[key]);
                return (
                  <div key={group.title} className="rounded-md border p-3">
                    <label className="flex items-center justify-between gap-3 font-medium">
                      <span>{group.title}</span>
                      <input type="checkbox" checked={all} onChange={(event) => toggleGroup(group, event.target.checked)} />
                    </label>
                    <div className="mt-3 space-y-2 border-t pt-3">
                      {group.items.map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={Boolean(selected[key])}
                            onChange={(event) => setSelected((current) => ({ ...current, [key]: event.target.checked }))}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}

        <Button className="w-full" disabled={saving}>
          <UserCog className="h-4 w-4" />
          {saving ? "Salvando..." : "Salvar cadastro"}
        </Button>
      </form>
    </Modal>
  );
}

function ToolbarChip({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <button
      type="button"
      className="hidden md:inline-flex inline-flex h-12 items-center gap-2 rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
    >
      {icon}
      {label}
      {!icon ? <ChevronDown className="h-4 w-4 text-slate-400" /> : null}
    </button>
  );
}

function IconAction({
  title,
  onClick,
  disabled,
  destructive,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-9 w-9 items-center justify-center rounded-full border transition ${
        destructive
          ? "border-rose-200 text-rose-600 hover:bg-rose-50"
          : "border-slate-200 text-slate-600 hover:bg-slate-50"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function inferCity(user: UserItem) {
  if (user.title?.toLowerCase().includes("são paulo")) return "São Paulo";
  if (user.title?.toLowerCase().includes("rio")) return "Rio de Janeiro";
  return "Não informado";
}

function formatCpfCnpjLike(phone: string | null, email: string) {
  const digits = `${phone ?? ""}${email}`.replace(/\D/g, "").slice(0, 14);
  if (digits.length >= 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length >= 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2}).*$/, "$1.$2.$3-$4");
  }
  return "Não informado";
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <AppDialog title={title} onClose={onClose} className="md:max-w-4xl">{children}</AppDialog>;
}
