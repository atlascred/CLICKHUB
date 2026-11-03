import { Suspense } from "react";
import { ArrowUpRight, ChartNoAxesCombined, MessageCircleMore, ShieldCheck, Users } from "lucide-react";
import { BrandLogo } from "@/components/layout/brand-logo";
import { LoginForm } from "@/modules/usuarios/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-page grid min-h-dvh bg-[#f5f8fd] text-slate-900 lg:grid-cols-[1.05fr_1fr]">
      <section className="crm-hero relative isolate flex flex-col overflow-hidden px-6 py-6 text-white sm:px-10 lg:min-h-dvh lg:px-12 lg:py-10 xl:px-16">
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-32 -z-10 h-[600px] w-[600px] rounded-full border-[80px] border-white/[0.04]" />
        <div className="flex items-center gap-3">
          <BrandLogo compact priority className="h-11 w-11 rounded-xl" />
          <div><p className="text-sm font-extrabold tracking-[0.12em]">CLICKHUB</p><p className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-blue-200">Seu workspace comercial</p></div>
        </div>
        <div className="crm-intro my-auto hidden py-12 lg:block">
          <p className="mb-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-200"><span className="h-1.5 w-1.5 rounded-full bg-blue-200" />Conexões que geram negócios</p>
          <h2 className="max-w-xl text-[clamp(2.5rem,3.5vw,3.75rem)] font-extrabold leading-[1.12] tracking-tight">Mais próximo<br />do cliente.<br /><span className="text-blue-200">Mais longe nos<br />resultados.</span></h2>
          <p className="mt-6 max-w-sm text-sm leading-7 text-blue-100/85">Conversas, oportunidades e sua equipe no mesmo lugar. Uma operação conectada do primeiro contato à próxima conquista.</p>
          <div className="mt-10 max-w-md overflow-hidden rounded-2xl border border-white/20 bg-white/10 shadow-xl shadow-blue-950/10">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><span className="text-xs font-semibold">Cada etapa, uma nova possibilidade.</span><ArrowUpRight className="h-4 w-4 text-blue-200" /></div>
            <div className="grid grid-cols-3 gap-2 p-5">{[{ icon: MessageCircleMore, label: "Converse" }, { icon: Users, label: "Conecte" }, { icon: ChartNoAxesCombined, label: "Conquiste" }].map(({ icon: Icon, label }) => <div key={label} className="space-y-3"><span className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/10"><Icon className="h-5 w-5 text-blue-100" /></span><p className="text-xs font-medium text-blue-100">{label}</p></div>)}</div>
          </div>
        </div>
        <p className="hidden text-[10px] uppercase tracking-[0.18em] text-blue-200/65 lg:block">Tecnologia para conectar. Pessoas para transformar.</p>
      </section>
      <section className="relative flex flex-col justify-center px-5 py-10 sm:px-10 lg:px-12">
        <div className="crm-intro mx-auto w-full max-w-[420px]">
          <div className="mb-8">
            <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700"><ShieldCheck className="h-3.5 w-3.5" />Acesso à plataforma</span>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Bom ter você aqui.</h1>
            <p className="mt-3 text-sm leading-6 text-slate-500">Entre com sua conta para continuar de onde parou.</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_40px_#12336708] sm:p-7">
            <Suspense fallback={<div role="status" className="h-64 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Carregando acesso...</div>}><LoginForm /></Suspense>
          </div>
          <p className="mt-6 text-center text-xs leading-6 text-slate-500">Precisa de acesso ou esqueceu sua senha?<br /><span className="font-semibold text-slate-700">Fale com o administrador da sua equipe.</span></p>
          <div className="mt-10 flex items-center justify-center gap-2 border-t border-slate-200 pt-6 text-[10px] font-medium tracking-wide text-slate-400"><ShieldCheck className="h-3.5 w-3.5" />CLICKHUB · Acesso exclusivo para sua equipe</div>
        </div>
      </section>
    </main>
  );
}
