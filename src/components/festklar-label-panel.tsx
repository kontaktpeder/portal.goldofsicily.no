import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BigChoice, PrimaryButton, TextField } from "@/components/field";
import {
  FESTKLAR_PACK_SIZES,
  FESTKLAR_VARIANT_IDS,
  festklarLabelsDocument,
  festklarPreviewDocument,
  festklarTestPrintInput,
  festklarVariant,
  formatFestklarDate,
  inferFestklarVariant,
  openFestklarPrintWindow,
  parseFestklarCopies,
  resolveFestklarPrint,
  suggestFestklarBestBefore,
  type FestklarIssue,
  type FestklarPackSize,
  type FestklarProductHint,
  type FestklarVariantId,
} from "@/lib/festklar-label";
import { useI18n, type TranslationKey } from "@/lib/i18n";

const ISSUE_KEYS: Record<FestklarIssue, TranslationKey> = {
  lot: "festklar_missing_lot",
  variant: "festklar_missing_variant",
  pack: "festklar_missing_pack",
  bestBefore: "festklar_missing_best_before",
  copies: "festklar_missing_copies",
};

export function LotFestklarPanel({
  lotCode,
  productionDate,
  shelfLifeDays,
  product,
}: {
  lotCode: string;
  productionDate: string;
  shelfLifeDays: number | null;
  product: FestklarProductHint;
}) {
  const { t } = useI18n();
  const inferred = inferFestklarVariant(product);
  const suggestedBestBefore = useMemo(
    () => suggestFestklarBestBefore(productionDate, shelfLifeDays) ?? "",
    [productionDate, shelfLifeDays],
  );
  const [variantId, setVariantId] = useState<FestklarVariantId | "">(inferred ?? "");
  const [packSize, setPackSize] = useState<FestklarPackSize | null>(null);
  const [bestBefore, setBestBefore] = useState(suggestedBestBefore);
  const [bestBeforeTouched, setBestBeforeTouched] = useState(false);
  const [copies, setCopies] = useState("");
  const [origin, setOrigin] = useState("");
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!bestBeforeTouched) setBestBefore(suggestedBestBefore);
  }, [bestBeforeTouched, suggestedBestBefore]);

  useEffect(() => {
    if (inferred) {
      setVariantId((current) => current || inferred);
    }
  }, [inferred]);

  const parsedCopies = parseFestklarCopies(copies);
  const input = {
    lotCode,
    bestBeforeIso: bestBefore,
    variantId,
    packSize,
    copies: parsedCopies ?? 0,
  };
  const resolved = resolveFestklarPrint(input);
  const previewHtml = origin ? festklarPreviewDocument(input, origin) : null;
  const shownDate = formatFestklarDate(bestBefore);

  async function printHtml(html: string) {
    setPrinting(true);
    const result = await openFestklarPrintWindow(html);
    setPrinting(false);
    if (result === "blocked") toast.error(t("festklar_popup_blocked"));
    if (result === "assets-failed") toast.error(t("festklar_assets_failed"));
  }

  async function printLabels() {
    if (!resolved.ok || !origin) return;
    await printHtml(festklarLabelsDocument(input, origin));
  }

  async function printTestLabel() {
    if (!origin) return;
    await printHtml(festklarLabelsDocument(festklarTestPrintInput(), origin));
  }

  return (
    <div className="surface-card mt-4 space-y-5 p-5">
        <div>
          <p className="eyebrow mb-2">{t("festklar_pack")}</p>
          <BigChoice
            value={packSize == null ? null : String(packSize)}
            onChange={(value) => setPackSize(value === "50" ? 50 : 6)}
            options={FESTKLAR_PACK_SIZES.map((size) => ({
              value: String(size),
              label: `${size} stk`,
            }))}
          />
          <p className="mt-2 text-sm text-muted-foreground">{t("festklar_pack_note")}</p>
          {variantId === "mix" && packSize === 6 ? (
            <p className="mt-1 text-sm text-muted-foreground">{t("festklar_mix_six")}</p>
          ) : null}
        </div>

        <div>
          <p className="eyebrow mb-2">{t("festklar_variant")}</p>
          <BigChoice
            value={variantId || null}
            onChange={(value) => setVariantId(value)}
            options={FESTKLAR_VARIANT_IDS.map((id) => ({
              value: id,
              label: festklarVariant(id).displayName,
            }))}
          />
          {inferred && variantId === inferred ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("festklar_suggested")}</p>
          ) : null}
        </div>

        <p className="text-sm">
          <span className="eyebrow mr-2">LOT</span>
          <span className="font-mono font-semibold">{lotCode}</span>
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <TextField
              label={t("best_before")}
              type="date"
              value={bestBefore}
              onChange={(value) => {
                setBestBeforeTouched(true);
                setBestBefore(value);
              }}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              {shownDate ? shownDate : t("festklar_missing_best_before")}
            </p>
          </div>
          <TextField
            label={t("festklar_copies")}
            type="number"
            value={copies}
            placeholder="1"
            onChange={setCopies}
          />
        </div>

        <div>
          <p className="eyebrow mb-2">{t("festklar_preview")}</p>
          {previewHtml ? (
            <LabelPreview html={previewHtml} />
          ) : (
            <div className="flex min-h-36 items-center justify-center rounded-2xl border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
              {t("festklar_preview_empty")}
            </div>
          )}
          {resolved.ok ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {resolved.copies === 1
                ? t("festklar_pages_one")
                : t("festklar_pages_many").replace("{count}", String(resolved.copies))}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("festklar_missing")}: {resolved.issues.map((issue) => t(ISSUE_KEYS[issue])).join(", ")}.
            </p>
          )}
        </div>

        <PrimaryButton onClick={() => void printLabels()} disabled={!resolved.ok || printing || !origin}>
          {printing ? "…" : t("festklar_print")}
        </PrimaryButton>
        <p className="text-sm text-muted-foreground">{t("festklar_print_hint")}</p>
        <button
          type="button"
          onClick={() => void printTestLabel()}
          disabled={printing || !origin}
          className="text-sm font-semibold text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60"
        >
          {t("festklar_test")}
        </button>
        <p className="text-sm text-muted-foreground">{t("festklar_test_note")}</p>
    </div>
  );
}

function LabelPreview({ html }: { html: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [natural, setNatural] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = frame.current;
    if (!node || natural.width <= 0) return;
    const apply = () => {
      const next = Math.min(1, node.clientWidth / natural.width);
      setScale((current) => (Math.abs(current - next) > 0.01 ? next : current));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [natural.width]);

  const previewWidth = natural.width > 0 ? natural.width * scale : undefined;
  const previewHeight = natural.height > 0 ? natural.height * scale : undefined;

  return (
    <div ref={frame} className="w-full">
      <div
        className="overflow-hidden rounded-xl border border-border bg-white"
        style={{ width: previewWidth, height: previewHeight }}
      >
        <iframe
          title="Festklar"
          srcDoc={html}
          onLoad={(event) => {
            const width = event.currentTarget.offsetWidth;
            const height = event.currentTarget.offsetHeight;
            if (width > 0 && height > 0) setNatural({ width, height });
          }}
          style={{
            width: "150mm",
            height: "100mm",
            border: 0,
            background: "#fff",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      </div>
    </div>
  );
}
