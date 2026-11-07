"use client";
import { fetchApi } from "@/lib/client-api";
import { sessionValue, storeSessionValue, removeSessionValue } from "@/lib/browser-storage";
import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { templateFields, templateUnsupportedReason, type OfficialTemplate } from "../lib/templates";
import { campaignContacts, uniqueCampaignContacts, OFFICIAL_CAMPAIGN_CONTACT_LIMIT_LABEL } from "../lib/campaign-contacts";
import type { Campaign, RecipientStatus } from "../services/mass-message.service";
type Connection = { configured: boolean; missing: string[]; displayNumber: string; webhookPath: string; templates: OfficialTemplate[] };
const labels: Record<RecipientStatus, string> = { queued: "Pendente", sending: "Processando", accepted: "Aceita pela Meta", delivered: "Entregue", read: "Lida", failed: "Falhou", uncertain: "Conferir na Meta" };
async function api(path: string, body?: unknown) {
  const response = await fetchApi(path, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || payload.status !== "success") throw new Error(payload.message || "Não foi possível consultar a campanha.");
  return payload.data;
}
export function MassMessagePanel() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"template" | "text">("template");
  const [message, setMessage] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testConsent, setTestConsent] = useState(false);
  const [testCampaign, setTestCampaign] = useState<Campaign | null>(null);
  const testRequestId = useRef<string | null>(null);
  const [contacts, setContacts] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [mediaUrl, setMediaUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipientPage, setRecipientPage] = useState(0);
  const recipientPageSize = 100;
  const requestId = useRef<string | null>(null);
  const mounted = useRef(true);
  const stop = useRef(false);
  const selected = connection?.templates.find(t => t.id === templateId);
  const unsupported = mode === "template" && selected ? templateUnsupportedReason(selected) : "";
  const fields = selected ? templateFields(selected) : [];
  const header = selected?.components.find(c => c.type === "HEADER");
  const needsMedia = header?.format && ["IMAGE", "VIDEO", "DOCUMENT"].includes(header.format);
  const templatePreview = selected?.components.filter(c => c.text).map(c => (c.text || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => values[`${c.type}:${name}`] || match)).join("\n\n");
  const preview = mode === "text" ? message : templatePreview;
  const contactSummary = useMemo(() => {
    if (!contacts.trim()) return { count: 0, error: "" };
    try { return { count: campaignContacts(contacts).length, error: "" }; }
    catch (error) { return { count: uniqueCampaignContacts(contacts).length, error: (error as Error).message }; }
  }, [contacts]);
  const recipientPageCount = Math.max(1, Math.ceil((campaign?.recipients.length || 0) / recipientPageSize));
  const currentRecipientPage = Math.min(recipientPage, recipientPageCount - 1);
  const visibleRecipients = campaign?.recipients.slice(currentRecipientPage * recipientPageSize, (currentRecipientPage + 1) * recipientPageSize) || [];

  useEffect(()=>{ testRequestId.current=null; setTestCampaign(null); },[mode,message,templateId,values,mediaUrl]);
  async function refresh() {
    setLoading(true); setError("");
    try { setConnection(await api("/api/envio-em-massa")); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const saved = sessionValue("clickhub:official-meta-campaign");
    if (saved) {
      requestId.current = saved;
      void api(`/api/envio-em-massa?id=${encodeURIComponent(saved)}`).then(data => { if (mounted.current) setCampaign(data); }).catch(() => {});
    }
    return () => { mounted.current = false; stop.current = true; };
  }, []);
  function resetRequest() { setRecipientPage(0); requestId.current = null; setCampaign(null); removeSessionValue("clickhub:official-meta-campaign"); }
  async function process(current: Campaign, test = false) {
    let next = current;
    while (mounted.current && !stop.current && next.recipients.some(r => ["queued", "sending"].includes(r.status))) {
      if (next.recipients.some(r => r.status === "sending")) await new Promise(resolve => setTimeout(resolve, 1500));
      if (stop.current || !mounted.current) break;
      next = await api("/api/envio-em-massa", { action: "next", id: next.id });
      if (mounted.current) { if(test)setTestCampaign(next); else setCampaign(next); }
    }
  }
  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); stop.current = false;
    try {
      let current = campaign;
      if (!current) {
        requestId.current ||= crypto.randomUUID();
        storeSessionValue("clickhub:official-meta-campaign", requestId.current);
        current = await api("/api/envio-em-massa", { action: "create", id: requestId.current, contacts, templateId, values, mediaUrl, consent, mode, message }) as Campaign;
        setRecipientPage(0);
        setCampaign(current);
      }
      await process(current);
    } catch (e) { setError((e as Error).message); } finally { if (mounted.current) setBusy(false); }
  }
  async function sendTest(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); stop.current=false;
    try {
      testRequestId.current ||= crypto.randomUUID();
      const current=await api("/api/envio-em-massa",{action:"create",id:testRequestId.current,contacts:testPhone,templateId,values,mediaUrl,consent:testConsent,mode,message,isTest:true}) as Campaign;
      setTestCampaign(current); await process(current,true);
    } catch(reason){setError(reason instanceof Error?reason.message:"Falha no teste.");}
    finally{if(mounted.current)setBusy(false);}
  }
  async function refreshCampaign() {
    if (!campaign) return;
    try { setCampaign(await api(`/api/envio-em-massa?id=${encodeURIComponent(campaign.id)}`)); } catch (e) { setError((e as Error).message); }
  }
  return <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
    <Card className="min-w-0"><CardHeader><div className="flex items-center gap-3"><div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-600"><BadgeCheck className="h-6 w-6" /></div><div><CardTitle>Novo disparo</CardTitle><CardDescription>Prepare a mensagem e selecione quem vai recebê-la.</CardDescription></div>{connection?.configured ? <Button type="button" variant="ghost" size="icon" className="ml-auto shrink-0 text-muted-foreground" aria-label="Atualizar modelos" title="Atualizar modelos" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button> : null}</div></CardHeader>
      <CardContent className="space-y-5">
        {!connection?.configured ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div className="text-sm font-medium">{loading ? "Consultando conexão..." : "Aguardando cadastro do número oficial"}</div><Button type="button" variant="outline" size="sm" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Atualizar conexão</Button></div> : null}
        {connection && !connection.configured ? <div className="space-y-3 rounded-xl border border-amber-400/30 bg-amber-500/5 p-5 text-sm"><p className="font-semibold">Cadastre seu WhatsApp na Meta para começar</p><ol className="list-decimal space-y-2 pl-5"><li>Cadastre a empresa e o número na plataforma oficial.</li><li>Conecte as credenciais da conta ao CLICKHUB.</li><li>Crie um modelo de mensagem e aguarde a aprovação da Meta.</li></ol><a className="inline-block font-medium text-primary underline" href="https://business.facebook.com/latest/whatsapp_manager" target="_blank" rel="noreferrer">Abrir WhatsApp Manager</a><p className="text-muted-foreground">Depois da configuração, clique em Atualizar conexão para carregar seus modelos.</p></div> : null}
        {error ? <div role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-600">{error}</div> : null}
        <form onSubmit={submit} className={`space-y-5 ${connection && !connection.configured ? "hidden md:block" : ""}`}><fieldset style={{ minWidth: 0 }} disabled={loading || !connection?.configured || busy || Boolean(campaign)} className="space-y-5 disabled:opacity-60">
          <div><p className="mb-2 text-sm font-medium">Tipo de envio</p><div role="group" aria-label="Tipo de envio" className="inline-flex rounded-xl bg-muted/60 p-1">{([{value:"template",label:"Modelo Meta"},{value:"text",label:"Texto livre"}] as const).map(item=><button type="button" key={item.value} aria-pressed={mode===item.value} className={`min-h-10 rounded-lg px-4 text-sm ${mode===item.value?"bg-primary text-primary-foreground":"text-muted-foreground"}`} onClick={()=>setMode(item.value)}>{item.label}</button>)}</div></div>
          {mode==="text" ? <label className="grid gap-2 text-sm font-medium">Mensagem<Textarea required maxLength={4096} className="min-h-40" value={message} onChange={e=>setMessage(e.target.value)} placeholder="Digite a mensagem..."/><span className="text-xs font-normal text-muted-foreground">Somente para contatos que responderam nas últimas 24 horas. Para iniciar um contato, escolha um modelo aprovado.</span></label> : <>
          <label className="grid gap-2 text-sm font-medium">Modelo aprovado<select required className="h-11 w-full min-w-0 rounded-md border bg-background px-3" value={templateId} onChange={e => { setTemplateId(e.target.value); setValues({}); setMediaUrl(""); requestId.current = null; }}><option value="">Selecione um modelo</option>{connection?.templates.map(t => <option key={t.id} value={t.id} disabled={t.status!=="APPROVED" || Boolean(templateUnsupportedReason(t))}>{t.name} · {t.language}{t.status!=="APPROVED" ? ` · ${t.status==="PENDING"?"Em análise":t.status}` : ""}{templateUnsupportedReason(t) ? " (não compatível)" : ""}</option>)}</select></label>
          {connection?.configured && !connection.templates.length ? <p className="text-sm text-muted-foreground">Nenhum modelo encontrado. Crie seu modelo no WhatsApp Manager e clique em Atualizar modelos.</p> : null}
          {unsupported ? <p className="text-sm text-amber-600">{unsupported}</p> : null}
          {fields.map(field => <label className="grid gap-2 text-sm" key={field.key}>Variável {`{{${field.name}}}`} · {field.component === "header" ? "Cabeçalho" : "Mensagem"}<Input required maxLength={1024} value={values[field.key] || ""} onChange={e => { setValues(v => ({ ...v, [field.key]: e.target.value })); requestId.current = null; }} /></label>)}
          {needsMedia ? <label className="grid gap-2 text-sm">Link HTTPS da {header?.format === "IMAGE" ? "imagem" : header?.format === "VIDEO" ? "mídia de vídeo" : "mídia do documento"}<Input type="url" required placeholder="https://..." value={mediaUrl} onChange={e => { setMediaUrl(e.target.value); requestId.current = null; }} /><span className="text-xs text-muted-foreground">A mídia precisa estar acessível à Meta e corresponder ao cabeçalho aprovado.</span></label> : null}
          </>}
          <label className="grid gap-2 text-sm font-medium">Contatos<Textarea required className="min-h-44" placeholder={"Cole um número por linha\n5511999999999"} value={contacts} onChange={e => { setContacts(e.target.value); requestId.current = null; }} /><span className="text-xs font-normal text-muted-foreground">{contactSummary.count.toLocaleString("pt-BR")} contatos detectados · até {OFFICIAL_CAMPAIGN_CONTACT_LIMIT_LABEL} por campanha. Números repetidos são removidos.</span>{contactSummary.error ? <span role="alert" className="text-xs font-normal text-rose-600">{contactSummary.error}</span> : null}</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)} required /><span>Os contatos autorizaram receber estas mensagens pelo WhatsApp.</span></label>
        </fieldset>
        {!campaign ? <Button type="submit" disabled={busy || loading || !connection?.configured || (mode === "template" ? !selected || selected.status!=="APPROVED" || Boolean(unsupported) : !message.trim()) || !consent || !contactSummary.count || Boolean(contactSummary.error)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Enviar pela Meta</Button> : null}
        </form>
        {campaign ? <div className="flex flex-wrap gap-2">{busy ? <Button variant="outline" onClick={() => { stop.current = true; }}>Pausar após o contato atual</Button> : <>{campaign.recipients.some(r => ["queued", "sending"].includes(r.status)) ? <Button disabled={!connection?.configured} onClick={() => void submit()}>Continuar pendentes</Button> : null}<Button variant="outline" onClick={resetRequest}>Nova campanha</Button></>}</div> : null}
        <p className="text-xs text-muted-foreground">Mantenha esta tela aberta durante o envio. Ao pausar ou sair, os contatos pendentes ficam salvos para continuar depois.</p>
      </CardContent></Card>
    <div className="min-w-0 space-y-6"><Card><CardHeader><CardTitle>Teste individual</CardTitle><CardDescription>Envie a mensagem preparada para um único número autorizado.</CardDescription></CardHeader><CardContent><form onSubmit={sendTest} className="space-y-4"><label className="grid gap-2 text-sm">Telefone de teste<Input type="tel" required placeholder="5511999999999" value={testPhone} disabled={busy} onChange={e=>{setTestPhone(e.target.value);testRequestId.current=null;setTestCampaign(null);}}/></label><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={testConsent} disabled={busy} onChange={e=>setTestConsent(e.target.checked)}/>Tenho autorização para enviar a este número.</label><Button type="submit" disabled={busy||!connection?.configured||!testConsent||!testPhone.trim()||(mode==="template"?selected?.status!=="APPROVED"||Boolean(unsupported):!message.trim())}><Send className="h-4 w-4"/>Enviar teste</Button>{testCampaign?.recipients.map(recipient=><p key={recipient.phone} role="status" className="text-sm">{labels[recipient.status]}{recipient.detail?` · ${recipient.detail}`:""}</p>)}</form></CardContent></Card><Card className="min-w-0"><CardHeader><CardTitle>Prévia da mensagem</CardTitle><CardDescription>{mode==="text"?"Texto da campanha":selected ? `${selected.name} · ${selected.language}` : "Selecione um modelo para visualizar."}</CardDescription></CardHeader><CardContent><div className="whitespace-pre-wrap break-words rounded-xl border bg-emerald-500/5 p-5 text-sm">{preview || "Seu modelo aparecerá aqui."}</div></CardContent></Card>
    <Card className="min-w-0"><CardHeader><CardTitle>Resultado da campanha</CardTitle><CardDescription>Aceita pela Meta indica recebimento pela API. Entrega e leitura dependem da confirmação do WhatsApp.</CardDescription></CardHeader><CardContent className="space-y-4">{campaign ? <><div className="grid grid-cols-3 gap-2 text-center text-sm">{[["Total", campaign.recipients.length], ["Aceitas / entregues", campaign.recipients.filter(r => ["accepted", "delivered", "read"].includes(r.status)).length], ["Pendentes", campaign.recipients.filter(r => ["queued", "sending"].includes(r.status)).length]].map(([label, value]) => <div className="rounded-lg border p-3" key={label}><p className="text-xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}</div><Button variant="outline" size="sm" disabled={busy} onClick={() => void refreshCampaign()}><RefreshCw className="h-4 w-4" />Atualizar resultado</Button><div className="max-h-96 space-y-2 overflow-y-auto">{visibleRecipients.map(r => <div key={r.phone} className="rounded-lg border p-3 text-sm"><div className="flex justify-between gap-2"><span>{r.phone}</span><span className={r.status === "failed" || r.status === "uncertain" ? "text-amber-600" : "text-emerald-600"}>{labels[r.status]}</span></div>{r.detail ? <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p> : null}</div>)}</div>{recipientPageCount > 1 ? <div className="flex items-center justify-between gap-2"><Button type="button" variant="outline" size="sm" disabled={currentRecipientPage === 0} onClick={() => setRecipientPage(currentRecipientPage - 1)}>Anterior</Button><span className="text-xs text-muted-foreground">Página {currentRecipientPage + 1} de {recipientPageCount}</span><Button type="button" variant="outline" size="sm" disabled={currentRecipientPage + 1 >= recipientPageCount} onClick={() => setRecipientPage(currentRecipientPage + 1)}>Próxima</Button></div> : null}</> : <p className="text-sm text-muted-foreground">Os resultados aparecerão aqui após iniciar uma campanha oficial.</p>}</CardContent></Card></div>
  </div>;
}
