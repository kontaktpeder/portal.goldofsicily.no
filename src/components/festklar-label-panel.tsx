import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  parseFestklarPackSize,
  resolveFestklarPrint,
  suggestFestklarBestBefore,
  type FestklarIssue,
  type FestklarPackSize,
  type FestklarProductHint,
  type FestklarVariantId,
} from "@/lib/festklar-label";
import { parseGoldLotCode } from "@/lib/gold-lot";
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
  const inferred =
    inferFestklarVariant(product) ??
    inferFestklarVariant({ lotLetter: parseGoldLotCode(lotCode)?.letter });
  const suggestedBestBefore = useMemo(
    () => suggestFestklarBestBefore(productionDate, shelfLifeDays) ?? "",
    [productionDate, shelfLifeDays],
  );
  const [variantId, setVariantId] = useState<FestklarVariantId | "">(inferred ?? "");
  const [packDraft, setPackDraft] = useState("");
  const [bestBefore, setBestBefore] = useState(suggestedBestBefore);
  const [bestBeforeTouched, setBestBeforeTouched] = useState(false);
  const [copies, setCopies] = useState("1");
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!bestBeforeTouched) setBestBefore(suggestedBestBefore);
  }, [bestBeforeTouched, suggestedBestBefore]);

  useEffect(() => {
    if (inferred) {
      setVariantId((current) => current || inferred);
    }
  }, [inferred]);

  const packSize = parseFestklarPackSize(packDraft);
  const parsedCopies = parseFestklarCopies(copies);
  const input = {
    lotCode,
    bestBeforeIso: bestBefore,
    variantId,
    packSize,
    copies: parsedCopies ?? 0,
  };
  const resolved = resolveFestklarPrint(input);
  const preview = resolveFestklarPrint({ ...input, copies: 1 });
  const previewHtml =
    typeof window === "undefined" || !preview.ok
      ? null
      : festklarPreviewDocument(input, window.location.origin);
  const shownDate = formatFestklarDate(bestBefore);

  function choosePack(size: FestklarPackSize) {
    setPackDraft(String(size));
  }

  async function printHtml(html: string) {
    setPrinting(true);
    const result = await openFestklarPrintWindow(html);
    setPrinting(false);
    if (result === "blocked") toast.error(t("festklar_popup_blocked"));
    if (result === "assets-failed") toast.error(t("festklar_assets_failed"));
  }

  async function printLabels() {
    if (!resolved.ok) return;
    await printHtml(festklarLabelsDocument(input, window.location.origin));
  }

  async function printTestLabel() {
    await printHtml(festklarLabelsDocument(festklarTestPrintInput(), window.location.origin));
  }

  return (
    <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="surface-card space-y-5 p-5">
        <div>
          <p className="eyebrow mb-2">{t("festklar_pack")}</p>
          <TextField
            label={t("festklar_pack_type")}
            type="number"
            value={packDraft}
            placeholder="6"
            onChange={setPackDraft}
          />
          <div className="mt-3">
            <BigChoice
              value={packSize == null ? null : String(packSize)}
              onChange={(value) => choosePack(value === "50" ? 50 : 6)}
              options={FESTKLAR_PACK_SIZES.map((size) => ({
                value: String(size),
                label: `${size} stk`,
              }))}
            />
          </div>
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

        {resolved.ok ? (
          <p className="text-sm text-muted-foreground">
            {resolved.copies === 1
              ? t("festklar_pages_one")
              : t("festklar_pages_many").replace("{count}", String(resolved.copies))}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("festklar_missing")}:{" "}
            {resolved.issues.map((issue) => t(ISSUE_KEYS[issue])).join(", ")}.
          </p>
        )}

        <PrimaryButton onClick={() => void printLabels()} disabled={!resolved.ok || printing}>
          {printing ? "…" : t("festklar_print")}
        </PrimaryButton>
        <p className="text-sm text-muted-foreground">{t("festklar_print_hint")}</p>
        <button
          type="button"
          onClick={() => void printTestLabel()}
          disabled={printing}
          className="text-sm font-semibold text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60"
        >
          {t("festklar_test")}
        </button>
        <p className="text-sm text-muted-foreground">{t("festklar_test_note")}</p>
      </div>

      <LabelSheet previewHtml={previewHtml} label={preview.ok ? preview.label : null} />
    </div>
  );
}

const SHEET_WIDTH = (150 * 96) / 25.4;
const SHEET_HEIGHT = (100 * 96) / 25.4;

function LabelSheet({
  previewHtml,
  label,
}: {
  previewHtml: string | null;
  label: { displayName: string; packLine: string; lotCode: string; bestBefore: string } | null;
}) {
  const { t } = useI18n();
  return (
    <div className="lg:sticky lg:top-20">
      <p className="eyebrow mb-3">{t("festklar_preview")}</p>
      {previewHtml && label ? (
        <>
          <div className="rounded-2xl bg-muted/70 p-4 sm:p-6">
            <LabelPreview html={previewHtml} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{t("festklar_variant")}</dt>
              <dd className="font-semibold">{label.displayName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("festklar_pack")}</dt>
              <dd className="font-semibold">{label.packLine}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">LOT</dt>
              <dd className="font-mono font-semibold">{label.lotCode}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("best_before")}</dt>
              <dd className="font-mono font-semibold">{label.bestBefore}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">{t("festklar_preview_sheet")}</p>
        </>
      ) : (
        <div className="flex aspect-[15/10] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/40 px-6 text-center text-sm text-muted-foreground">
          {t("festklar_preview_empty")}
        </div>
      )}
    </div>
  );
}

function LabelPreview({ html }: { html: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const apply = () => {
      const width = node.clientWidth;
      if (width <= 0) return;
      const next = Math.min(1, width / SHEET_WIDTH);
      setScale((current) => (Math.abs(current - next) > 0.005 ? next : current));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frame} className="w-full">
      <div
        className="relative overflow-hidden rounded-sm bg-white shadow-[0_16px_40px_rgba(28,22,16,0.22)] ring-1 ring-black/10"
        style={{ width: "100%", maxWidth: SHEET_WIDTH, aspectRatio: "15 / 10" }}
      >
        <iframe
          title="Festklar"
          srcDoc={html}
          scrolling="no"
          className="pointer-events-none absolute top-0 left-0 overflow-hidden border-0 bg-white"
          style={{
            width: SHEET_WIDTH,
            height: SHEET_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      </div>
    </div>
  );
}
