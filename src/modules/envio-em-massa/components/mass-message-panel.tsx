"use client";

import { whatsappAgentLabel } from "@/lib/whatsapp-agent-label";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ImagePlus, Loader2, Megaphone, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils/cn";

type DispatchResult = {
  total: number;
  sent: number;
  failed: number;
  contacts: Array<{
    phone: string;
    status: "sent" | "failed";
    detail: string;
  }>;
};

const LAST_MASS_MESSAGE_RESULT_KEY = "clickhub:last-mass-message-result";

export function MassMessagePanel() {
  const [agents,setAgents]=useState<Array<{id:string;instanceName:string}>>([]);
  const [agentId,setAgentId]=useState("");
  useEffect(()=>{fetch("/api/whatsapp/agents").then(r=>r.json()).then(r=>{if(r.status==="success")setAgents(r.data);}).catch(()=>{});},[]);
  const [contacts, setContacts] = useState("");
  const [message, setMessage] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DispatchResult | null>(null);

  const estimatedContacts = useMemo(() => {
    const unique = new Set(
      contacts
        .split(/\r?\n|;|,/)
        .map((item) => item.replace(/\D/g, ""))
        .filter((item) => item.length >= 10),
    );

    return unique.size;
  }, [contacts]);

  useEffect(() => {
    try {
      setResult(null);
      if(!agentId) return;
      const stored = window.localStorage.getItem(`${LAST_MASS_MESSAGE_RESULT_KEY}:${agentId}`);
      if (!stored) return;

      const parsed = JSON.parse(stored) as DispatchResult;
      if (
        typeof parsed?.total === "number" &&
        typeof parsed?.sent === "number" &&
        typeof parsed?.failed === "number" &&
        Array.isArray(parsed?.contacts)
      ) {
        setResult(parsed);
      }
    } catch {
      window.localStorage.removeItem(`${LAST_MASS_MESSAGE_RESULT_KEY}:${agentId}`);
    }
  }, [agentId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agentId) { setError("Selecione a instância de envio."); return; }
    setIsSending(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("agentId", agentId);
      formData.set("contacts", contacts);
      formData.set("message", message);
      formData.set("caption", caption);
      if (file) formData.set("file", file);

      const response = await fetch("/api/envio-em-massa", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        status: "success" | "error";
        message: string;
        data?: DispatchResult;
      };

      if (!response.ok || payload.status !== "success" || !payload.data) {
        throw new Error(payload.message || "Não foi possível concluir o envio.");
      }

      setResult(payload.data);
      window.localStorage.setItem(`${LAST_MASS_MESSAGE_RESULT_KEY}:${agentId}`, JSON.stringify(payload.data));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Falha no envio em massa.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-600">
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Disparo em massa no WhatsApp</CardTitle>
              <CardDescription>
                Envie mensagem, imagem, vídeo, áudio ou documento com descrição para vários contatos de uma vez.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <label className="grid gap-2 text-sm font-medium">WhatsApp de envio<select required disabled={isSending} className="h-10 rounded-md border bg-background px-3" value={agentId} onChange={event=>setAgentId(event.target.value)}><option value="">Selecione NIO FIBRA ou VIVO FIBRA</option>{agents.map(agent=><option key={agent.id} value={agent.id}>{whatsappAgentLabel(agent.instanceName)}</option>)}</select></label>
            <div className="grid gap-2">
              <p className="text-sm font-medium">Contatos</p>
              <Textarea
                value={contacts}
                onChange={(event) => setContacts(event.target.value)}
                placeholder={"Cole um número por linha\n5511999999999\n5511988887777"}
                className="min-h-44"
              />
              <p className="text-xs text-muted-foreground">
                Você pode separar por linha, vírgula ou ponto e vírgula. Contatos detectados: <strong>{estimatedContacts}</strong>
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="grid gap-2">
                <p className="text-sm font-medium">Mensagem de texto</p>
                <Textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Digite a mensagem que será disparada para todos os contatos."
                  className="min-h-36"
                />
              </div>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <p className="text-sm font-medium">Descrição da mídia</p>
                  <Textarea
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    placeholder="Legenda opcional para imagem, vídeo ou documento."
                    className="min-h-24"
                  />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-medium">Anexo</p>
                  <Input
                    type="file"
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                  <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                    {file ? (
                      <span>
                        Arquivo selecionado: <strong>{file.name}</strong>
                      </span>
                    ) : (
                      <span>Envie imagem, vídeo, áudio ou documento para disparar junto com a descrição.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={isSending}>
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {isSending ? "Enviando..." : "Disparar mensagens"}
              </Button>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ImagePlus className="h-4 w-4" />
                O envio usa a instância selecionada e registra as mensagens no histórico correspondente. Arquivos de até 3 MB; até 100 contatos por lote.
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Boas práticas</CardTitle>
            <CardDescription>Evite bloqueios e mantenha uma abordagem mais humana no disparo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>1. Use listas segmentadas e números com consentimento.</p>
            <p>2. Prefira mensagens curtas, claras e com CTA direto.</p>
            <p>3. Para mídia, use uma descrição curta e objetiva.</p>
            <p>4. Revise os contatos antes de disparar.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resultado do último envio</CardTitle>
            <CardDescription>Resumo rápido do lote processado.</CardDescription>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <ResultMetric label="Total" value={String(result.total)} tone="slate" />
                  <ResultMetric label="Enviadas" value={String(result.sent)} tone="emerald" />
                  <ResultMetric label="Falhas" value={String(result.failed)} tone="rose" />
                </div>

                <div className="space-y-2">
                  {result.contacts.map((contact) => (
                    <div key={`${contact.phone}-${contact.status}`} className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
                      <div>
                        <p className="font-medium">{contact.phone}</p>
                        <p className="text-xs text-muted-foreground">{contact.detail}</p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                          contact.status === "sent"
                            ? "bg-emerald-500/10 text-emerald-700"
                            : "bg-rose-500/10 text-rose-700",
                        )}
                      >
                        {contact.status === "sent" ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <TriangleAlert className="h-3.5 w-3.5" />
                        )}
                        {contact.status === "sent" ? "Enviado" : "Falhou"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Faça um disparo para ver o resumo de sucesso e falha aqui.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ResultMetric({ label, value, tone }: { label: string; value: string; tone: "slate" | "emerald" | "rose" }) {
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-500/10 text-emerald-700"
      : tone === "rose"
        ? "bg-rose-500/10 text-rose-700"
        : "bg-slate-500/10 text-slate-700";

  return (
    <div className={cn("rounded-xl border px-4 py-3", toneClass)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
