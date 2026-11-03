import { cn } from "@/utils/cn";

type BrandLogoProps = {
  compact?: boolean;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
};

export function BrandLogo({
  compact = false,
  className,
  imageClassName,
  priority = false,
}: BrandLogoProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-cyan-300/20 bg-[#04162b]",
        compact ? "h-12 w-12" : "h-28 w-28",
        className,
      )}
    >
      <img
        src="/brand/logosemfundo.png"
        alt="CLICKHUB"
        className={cn("h-full w-full object-contain p-1", imageClassName)}
        loading={priority ? "eager" : "lazy"}
      />
    </div>
  );
}
