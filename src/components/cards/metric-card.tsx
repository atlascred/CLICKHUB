import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type MetricCardProps = {
  title: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  href?: string;
  tone?: "blue" | "teal" | "indigo" | "amber";
};

const tones = {
  blue: { surface: "from-blue-500/10", ink: "text-blue-700 dark:text-blue-300", icon: "bg-blue-600", line: "bg-blue-500" },
  teal: { surface: "from-teal-500/10", ink: "text-teal-700 dark:text-teal-300", icon: "bg-teal-600", line: "bg-teal-500" },
  indigo: { surface: "from-indigo-500/10", ink: "text-indigo-700 dark:text-indigo-300", icon: "bg-indigo-600", line: "bg-indigo-500" },
  amber: { surface: "from-amber-500/10", ink: "text-amber-800 dark:text-amber-300", icon: "bg-amber-600", line: "bg-amber-500" },
};

export function MetricCard({ title, value, helper, icon: Icon, href, tone = "blue" }: MetricCardProps) {
  const color = tones[tone];
  const card = (
    <Card className={`group relative h-full overflow-hidden bg-gradient-to-br ${color.surface} to-transparent transition-colors hover:border-primary/25`}>
      <div className={`absolute inset-x-0 top-0 h-0.5 ${color.line}`} />
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <p className={`text-xs font-bold ${color.ink}`}>{title}</p>
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white shadow-sm ${color.icon}`}><Icon className="h-4 w-4" aria-hidden="true" /></div>
        </div>
        <div className="min-w-0">
          <p className="break-words text-[clamp(1.5rem,2.1vw,2rem)] font-extrabold tracking-tight tabular-nums">{value}</p>
          <div className="mt-4 flex items-center justify-between border-t border-foreground/5 pt-3"><p className="text-[11px] text-muted-foreground">{helper}</p>{href ? <ArrowUpRight className={`h-3.5 w-3.5 ${color.ink}`} /> : null}</div>
        </div>
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link href={href}>{card}</Link>;
  }

  return card;
}
