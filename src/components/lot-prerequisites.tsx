import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { type LotPrerequisites } from "@/hooks/use-lot-prerequisites";

export function LotPrerequisitesBanner({ check }: { check: LotPrerequisites }) {
  const { t, lang } = useI18n();
  if (check.loading || check.ok) return null;

  return (
    <div className="mt-5 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-2">
          <p className="font-semibold">{t("lot_prereq_title")}</p>
          {check.schemaMissing ? (
            <p className="text-sm text-muted-foreground">{t("lot_schema_missing")}</p>
          ) : null}
          {check.missingLetters.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">{t("lot_letter_required_admin")}</p>
              <ul className="text-sm">
                {check.missingLetters.map((product) => (
                  <li key={product.id}>{lang === "en" ? product.name_en : product.name_no}</li>
                ))}
              </ul>
              <Link
                to="/admin/products"
                className="inline-flex rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                {t("open_products")}
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
