import logo from "@/assets/gos-logo.png";
import { cn } from "@/lib/utils";
import { useI18n, type Lang } from "@/lib/i18n";

export function Wordmark({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const height = size === "lg" ? 68 : size === "md" ? 52 : 40;
  return (
    <img
      src={logo}
      alt="Gold of Sicily"
      width={1380}
      height={454}
      className={cn("w-auto object-contain object-left", className)}
      style={{ height }}
    />
  );
}

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang } = useI18n();
  const options: Lang[] = ["no", "en"];
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-card p-1",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLang(option)}
          aria-pressed={lang === option}
          className={cn(
            "min-w-11 rounded-full px-3 py-1.5 text-xs font-semibold tracking-[0.14em] uppercase transition-colors",
            lang === option
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
