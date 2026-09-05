import { useRef, useState } from "react";
import { Copy, FileUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PrimaryButton } from "@/components/field";
import { useI18n } from "@/lib/i18n";
import {
  MENU_FILE_ACCEPT,
  MENU_FILE_BUCKET,
  menuFileDisplayName,
  menuFileObjectPath,
  validateMenuFile,
} from "@/lib/venue-menu-file";

export function MenuFileUpload({
  venueId,
  path,
  url,
  onChanged,
}: {
  venueId: string;
  path: string | null;
  url: string | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const problem = validateMenuFile(file);
    if (problem === "too_large") {
      toast.error(t("menu_file_too_large"));
      return;
    }
    if (problem === "bad_type") {
      toast.error(t("menu_file_bad_type"));
      return;
    }

    setBusy(true);
    const objectPath = menuFileObjectPath(venueId, file.name);
    const { error: uploadError } = await supabase.storage.from(MENU_FILE_BUCKET).upload(objectPath, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) {
      setBusy(false);
      toast.error(uploadError.message);
      return;
    }

    const publicUrl = supabase.storage.from(MENU_FILE_BUCKET).getPublicUrl(objectPath).data.publicUrl;
    const { error: updateError } = await supabase
      .from("venues")
      .update({
        menu_material_path: objectPath,
        menu_material_url: publicUrl,
      })
      .eq("id", venueId);

    if (path && path !== objectPath) {
      await supabase.storage.from(MENU_FILE_BUCKET).remove([path]);
    }

    setBusy(false);
    if (updateError) {
      toast.error(updateError.message);
      return;
    }
    toast.success(t("menu_file_uploaded"));
    onChanged();
  }

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("menu_file_copied"));
    } catch {
      toast.error(url);
    }
  }

  async function removeFile() {
    setBusy(true);
    if (path) {
      await supabase.storage.from(MENU_FILE_BUCKET).remove([path]);
    }
    const { error } = await supabase
      .from("venues")
      .update({ menu_material_path: null, menu_material_url: null })
      .eq("id", venueId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("menu_file_removed"));
    onChanged();
  }

  return (
    <div className="surface-card space-y-4 p-5">
      <div>
        <p className="font-semibold">{t("menu_file")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("menu_file_hint")}</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={MENU_FILE_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFile(event.dataTransfer.files?.[0]);
        }}
        className={`flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
          dragging ? "border-primary bg-primary/5" : "border-border bg-card"
        }`}
      >
        <FileUp className="mb-3 size-6 text-muted-foreground" />
        <p className="text-sm font-medium">{busy ? t("menu_file_uploading") : t("menu_file_drop")}</p>
        <p className="mt-3 text-xs font-semibold tracking-[0.08em] text-primary uppercase">
          {t("menu_file_choose")}
        </p>
      </div>

      {url ? (
        <div className="space-y-3">
          <div>
            <span className="eyebrow mb-2 block">{t("menu_file_public_url")}</span>
            <p className="break-all rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm">
              {url}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{menuFileDisplayName(path)}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <PrimaryButton onClick={copyUrl} className="sm:flex-1">
              <span className="inline-flex items-center justify-center gap-2">
                <Copy className="size-4" />
                {t("menu_file_copy")}
              </span>
            </PrimaryButton>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-16 items-center justify-center rounded-2xl border-2 border-border px-4 text-sm font-bold tracking-[0.08em] uppercase sm:flex-1"
            >
              {t("menu_file_open")}
            </a>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void removeFile()}
            className="inline-flex items-center gap-1.5 text-xs text-destructive disabled:opacity-60"
          >
            <Trash2 className="size-3.5" />
            {t("menu_file_remove")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
