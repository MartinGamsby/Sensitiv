"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export const SOLARI_KEY_STORAGE = "sensitiv:solariKey";

export interface SolariKeyFieldProps {
  onChange: (key: string) => void;
  /** Test seam: defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

function readStored(): string {
  try {
    return sessionStorage.getItem(SOLARI_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

/**
 * BYOK Solari key. Shown ONLY when `GET /api/health` reports `solari === false`
 * (no server key). The value lives in `sessionStorage` for this tab only — never
 * `localStorage`, never a cookie — is sent once in the `POST /api/jobs` body,
 * and is never rendered back after submit.
 */
export function SolariKeyField({ onChange, fetchImpl }: SolariKeyFieldProps) {
  const t = useTranslations("form.solari");
  const [serverHasKey, setServerHasKey] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const hydrated = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    let cancelled = false;
    void (async () => {
      try {
        const res = await doFetch("/api/health");
        const body = (await res.json()) as { solari?: boolean };
        if (!cancelled) setServerHasKey(body.solari === true);
      } catch {
        if (!cancelled) setServerHasKey(true); // fail closed: hide the field
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  useEffect(() => {
    if (serverHasKey === false && !hydrated.current) {
      hydrated.current = true;
      const stored = readStored();
      if (stored) {
        setValue(stored);
        onChangeRef.current(stored);
      }
    }
  }, [serverHasKey]);

  if (serverHasKey === null || serverHasKey === true) return null;

  function update(next: string) {
    setValue(next);
    try {
      if (next) sessionStorage.setItem(SOLARI_KEY_STORAGE, next);
      else sessionStorage.removeItem(SOLARI_KEY_STORAGE);
    } catch {
      // sessionStorage unavailable — the key simply won't persist across reloads.
    }
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium" htmlFor="solari-key">
        {t("label")}
      </label>
      <input
        id="solari-key"
        type="password"
        autoComplete="off"
        value={value}
        placeholder={t("placeholder")}
        onChange={(e) => update(e.target.value)}
        className="rounded border border-amber-400 bg-transparent px-2 py-1.5 text-sm"
      />
      <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {t("banner")}
      </p>
    </div>
  );
}
