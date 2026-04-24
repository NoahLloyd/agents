"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";

export default function SettingsPage({ onClose }: { onClose: () => void }) {
  const [vaultDir, setVaultDir] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getConfig()
      .then((c) => {
        setVaultDir(c.vaultDir);
        setDraft(c.vaultDir);
      })
      .catch((e) => setErr((e as Error).message));
  }, []);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dirty = vaultDir !== null && draft !== vaultDir;

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.updateConfig({ vaultDir: draft.trim() });
      setVaultDir(r.vaultDir);
      setDraft(r.vaultDir);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1500);
    } catch (e) {
      setStatus("error");
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-zinc-950 text-zinc-100">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          title="Back (Esc)"
        >
          <ArrowLeft size={14} />
          back
        </button>
        <span className="text-sm font-medium text-zinc-200">settings</span>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-xl px-6 py-8">
          <div className="space-y-5">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                working dir
              </label>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                  if (e.key === "Escape") setDraft(vaultDir ?? "");
                }}
                placeholder="/path/to/your/vault"
                disabled={vaultDir === null || busy}
                className={`w-full rounded border bg-zinc-900 px-3 py-2 font-mono text-xs outline-none transition ${
                  dirty
                    ? "border-amber-700 text-amber-100"
                    : "border-zinc-800 text-zinc-100 focus:border-zinc-600"
                }`}
              />
              <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-600">
                <span>
                  The base directory the dashboard uses for file watching and
                  pin search. File watcher picks up changes on restart.
                </span>
                {status === "saved" && (
                  <span className="text-emerald-400">saved</span>
                )}
              </div>
              {err && (
                <div className="mt-2 rounded border border-red-900 bg-red-900/20 px-2 py-1 text-xs text-red-300">
                  {err}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={!dirty || busy}
                className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-700"
              >
                {busy ? "saving…" : "save"}
              </button>
              {dirty && (
                <button
                  onClick={() => setDraft(vaultDir ?? "")}
                  className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
                >
                  cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
