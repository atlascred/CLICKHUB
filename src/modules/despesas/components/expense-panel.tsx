"use client";

import { FormEvent, ReactNode, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Pencil, Plus, ReceiptText, Search, Trash2, WalletCards, X } from "lucide-react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApiResource } from "@/hooks/use-api-resource";
import type { ApiResult } from "@/types/api";

type ExpenseStatus = "PENDING" | "PAID" | "OVERDUE";
type Expense = { id: string; description: string; amount: string | number; status: ExpenseStatus; paymentMethod: string | null; dueAt: string | null; paidAt: string | null; notes: string | null; createdAt: string };
const statusLabel = { PENDING: "Pendente", PAID: "Pago", OVERDUE: "Atrasado" };
const paymentMethods = ["Pix", "Boleto", "Cartão de crédito", "Cartão de débito", "Dinheiro", "Transferência bancária", "Débito automático", "Outro"];
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function ExpensePanel() {
  const resource = useApiResource<Expense[]>("/api/expenses");
  const [editing, setEditing] = useState<Expense | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ExpenseStatus | "">("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const expenses = resource.data ?? [];
  const filtered = useMemo(() => expenses.filter((item) => (!filter || item.status === filter) && `${item.description} ${item.paymentMethod ?? ""} ${item.notes ?? ""}`.toLowerCase().includes(query.toLowerCase())), [expenses, filter, query]);
  const total = (status: ExpenseStatus) => expenses.filter((item) => item.status === status).reduce((sum, item) => sum + Number(item.amount), 0);

  async function save(payload: Record<string, unknown>) {
    setSaving(true); const response = await fetch(editing ? `/api/expenses/${editing.id}` : "/api/expenses", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = (await response.json()) as ApiResult<Expense>; setMessage(result.message); setSaving(false);
    if (response.ok) { setEditing(undefined); await resource.refresh(); window.dispatchEvent(new Event("crm:dashboard-refresh")); }
  }
  async function changeStatus(expense: Expense, status: ExpenseStatus) {
    const response = await fetch(`/api/expenses/${expense.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (response.ok) { await resource.refresh(); window.dispatchEvent(new Event("crm:dashboard-refresh")); }
  }
  async function remove(expense: Expense) {
    if (!window.confirm(`Excluir a despesa ${expense.description}?`)) return;
    const response = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
    if (response.ok) { await resource.refresh(); window.dispatchEvent(new Event("crm:dashboard-refresh")); }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Controle de despesas</h2><p className="text-sm text-muted-foreground">Contas pagas, pendentes e vencidas.</p></div><Button onClick={() => setEditing(null)}><Plus className="h-4 w-4" />Cadastrar despesa</Button></div>
    {message && <p className="rounded-md border bg-card px-4 py-3 text-sm">{message}</p>}
    <div className="grid grid-cols-3 gap-2 sm:gap-3"><Metric label="Pendente" value={total("PENDING")} icon={<Clock3 className="h-5 w-5" />} tone="amber" /><Metric label="Atrasado" value={total("OVERDUE")} icon={<AlertTriangle className="h-5 w-5" />} tone="red" /><Metric label="Pago" value={total("PAID")} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" /></div>
    <div className="flex flex-col gap-3 sm:flex-row"><div className="relative max-w-lg flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar descrição ou forma de pagamento" /></div><select className="h-10 rounded-md border bg-background px-3 text-sm" value={filter} onChange={(event) => setFilter(event.target.value as ExpenseStatus | "")}><option value="">Todos os status</option><option value="PENDING">Pendente</option><option value="OVERDUE">Atrasado</option><option value="PAID">Pago</option></select></div>
    <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="crm-mobile-table w-full min-w-[820px] text-left text-sm"><thead className="border-b bg-muted/60 text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Despesa</th><th className="px-4 py-3 font-medium">Valor</th><th className="px-4 py-3 font-medium">Vencimento</th><th className="px-4 py-3 font-medium">Pagamento</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Ações</th></tr></thead><tbody>
      {resource.loading ? <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Carregando despesas</td></tr> : filtered.map((expense) => <tr key={expense.id} className="border-b last:border-0"><td className="px-4 py-4"><p className="font-medium">{expense.description}</p><p className="line-clamp-1 text-xs text-muted-foreground">{expense.notes || "Sem observações"}</p></td><td data-label="Valor" className="px-4 py-4 font-semibold">{currency.format(Number(expense.amount))}</td><td data-label="Vencimento" className="px-4 py-4">{formatDate(expense.dueAt)}</td><td data-label="Pagamento" className="px-4 py-4">{expense.paymentMethod || "Não definida"}</td><td data-label="Status" className="px-4 py-4"><select className="h-9 rounded-md border bg-background px-2 text-sm" value={expense.status} onChange={(event) => changeStatus(expense, event.target.value as ExpenseStatus)}><option value="PENDING">Pendente</option><option value="OVERDUE">Atrasado</option><option value="PAID">Pago</option></select></td><td className="px-4 py-4"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Editar" onClick={() => setEditing(expense)}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Excluir" onClick={() => remove(expense)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></td></tr>)}
      {!resource.loading && !filtered.length && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nenhuma despesa encontrada</td></tr>}
    </tbody></table></div></CardContent></Card>
    {editing !== undefined && <ExpenseModal expense={editing} saving={saving} onClose={() => setEditing(undefined)} onSave={save} />}
  </div>;
}

function ExpenseModal({ expense, saving, onClose, onSave }: { expense: Expense | null; saving: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); await onSave({ description: data.get("description"), amount: Number(data.get("amount")), dueAt: data.get("dueAt"), status: data.get("status"), paymentMethod: data.get("paymentMethod"), notes: data.get("notes") }); }
  return <Modal title={expense ? "Editar despesa" : "Cadastrar despesa"} onClose={onClose}><form className="space-y-4" onSubmit={submit}><Input name="description" defaultValue={expense?.description ?? ""} placeholder="Descrição da despesa" required /><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-medium text-muted-foreground"><span>Valor</span><Input name="amount" defaultValue={expense?.amount ?? ""} type="number" min="0.01" step="0.01" placeholder="Valor" required /></label><label className="grid gap-1 text-xs font-medium text-muted-foreground"><span>Vencimento</span><Input name="dueAt" defaultValue={dateInput(expense?.dueAt)} type="date" /></label></div><div className="grid gap-3 sm:grid-cols-2"><select name="status" defaultValue={expense?.status ?? "PENDING"} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="PENDING">Pendente</option><option value="OVERDUE">Atrasado</option><option value="PAID">Pago</option></select><select name="paymentMethod" defaultValue={expense?.paymentMethod ?? ""} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="">Forma de pagamento</option>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></div><Textarea name="notes" defaultValue={expense?.notes ?? ""} placeholder="Observações" /><Button className="w-full" disabled={saving}><WalletCards className="h-4 w-4" />{saving ? "Salvando..." : "Salvar despesa"}</Button></form></Modal>;
}

function Metric({ label, value, icon, tone }: { label: string; value: number; icon: ReactNode; tone: "amber" | "red" | "green" }) { const colors = { amber: "bg-amber-100 text-amber-700", red: "bg-red-100 text-red-700", green: "bg-emerald-100 text-emerald-700" }; return <Card><CardContent className="flex flex-col items-start gap-2 p-3 sm:flex-row sm:items-center sm:gap-3 sm:p-4"><div className={`hidden h-10 w-10 sm:flex items-center justify-center rounded-md ${colors[tone]}`}>{icon}</div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-base font-semibold sm:text-xl">{currency.format(value)}</p></div></CardContent></Card>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <AppDialog title={title} onClose={onClose} className="md:max-w-xl">{children}</AppDialog>;
}

function formatDate(value: string | null) { return value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "Sem vencimento"; }
function dateInput(value?: string | null) { return value ? value.slice(0, 10) : ""; }
