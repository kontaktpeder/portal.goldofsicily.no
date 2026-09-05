import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function QuestionCard({
  step,
  label,
  question,
  children,
}: {
  step: number;
  label: string;
  question: string;
  children: ReactNode;
}) {
  return (
    <section className="surface-card p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[0.7rem] font-bold text-primary-foreground">
          {step}
        </span>
        <span className="eyebrow">{label}</span>
      </div>
      <h2 className="mt-3 text-xl leading-snug font-semibold sm:text-2xl">{question}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function BigChoice<T extends string | boolean>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; tone?: "neutral" | "positive" | "negative" }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={cn(
              "min-h-16 rounded-2xl border-2 px-2 py-4 text-base font-semibold transition-all active:scale-[0.98]",
              selected
                ? "border-transparent bg-primary text-primary-foreground shadow-[var(--shadow-card)]"
                : "border-border bg-card text-foreground hover:border-primary/60",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function NumberStepper({
  value,
  onChange,
  step = 10,
  autoFocus,
  label,
  compact,
}: {
  value: number | "";
  onChange: (value: number | "") => void;
  step?: number;
  autoFocus?: boolean;
  label?: string;
  compact?: boolean;
}) {
  const numeric = value === "" ? 0 : value;
  const smallStep = 1;
  const btn = compact
    ? "flex h-12 flex-1 min-w-8 items-center justify-center rounded-xl border-2 border-border bg-card text-sm font-bold transition-colors hover:border-primary/60 active:scale-95"
    : "flex h-14 flex-1 min-w-10 items-center justify-center rounded-2xl border-2 border-border bg-card text-base font-bold transition-colors hover:border-primary/60 active:scale-95";
  const controls = (
    <div className={cn("flex items-center", compact ? "gap-1.5" : "gap-2")}>
      <button
        type="button"
        aria-label={`minus ${step}`}
        onClick={() => onChange(Math.max(0, numeric - step))}
        className={btn}
      >
        -{step}
      </button>
      <button
        type="button"
        aria-label="minus one"
        onClick={() => onChange(Math.max(0, numeric - smallStep))}
        className={btn}
      >
        -1
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" ? "" : Math.max(0, Number.parseInt(raw, 10) || 0));
        }}
        className={cn(
          "min-w-0 flex-[1.5] border-2 border-border bg-card text-center font-bold tabular-nums outline-none focus:border-primary",
          compact ? "h-12 rounded-xl text-xl" : "h-16 rounded-2xl text-2xl",
        )}
      />
      <button
        type="button"
        aria-label="plus one"
        onClick={() => onChange(numeric + smallStep)}
        className={btn}
      >
        +1
      </button>
      <button
        type="button"
        aria-label={`plus ${step}`}
        onClick={() => onChange(numeric + step)}
        className={btn}
      >
        +{step}
      </button>
    </div>
  );
  if (!label) return controls;
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      {controls}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  type = "text",
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  label?: string;
}) {
  return (
    <label className="block">
      {label ? <span className="eyebrow mb-2 block">{label}</span> : null}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
      />
    </label>
  );
}

export function TextAreaField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      rows={3}
      onChange={(event) => onChange(event.target.value)}
      className="w-full resize-none rounded-2xl border-2 border-border bg-card px-4 py-3 text-base outline-none focus:border-primary"
    />
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "min-h-16 w-full rounded-2xl bg-primary text-base font-bold tracking-[0.08em] text-primary-foreground uppercase shadow-[var(--shadow-lift)] transition-all active:scale-[0.99] disabled:opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}
