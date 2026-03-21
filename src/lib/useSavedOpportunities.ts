"use client";

import { useState, useEffect, useCallback } from "react";
import { ScoredOpportunity } from "./types";

const LS_KEY = "govpilot_saved_opps";

function load(): ScoredOpportunity[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as ScoredOpportunity[]) : [];
  } catch { return []; }
}

function save(opps: ScoredOpportunity[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(opps)); } catch { /* quota */ }
}

function isExpired(opp: ScoredOpportunity): boolean {
  const raw = opp.responseDeadLine ?? opp.reponseDeadLine;
  if (!raw) return false;
  const d = new Date(raw);
  return !isNaN(d.getTime()) && d.getTime() < Date.now();
}

export function useSavedOpportunities() {
  const [saved, setSaved] = useState<ScoredOpportunity[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    const all = load();
    // Auto-purge expired ones on load
    const active = all.filter((o) => !isExpired(o));
    if (active.length !== all.length) save(active);
    setSaved(active);
  }, []);

  const toggle = useCallback((opp: ScoredOpportunity) => {
    setSaved((prev) => {
      const exists = prev.some((o) => o.noticeId === opp.noticeId);
      const next = exists
        ? prev.filter((o) => o.noticeId !== opp.noticeId)
        : [...prev, opp];
      save(next);
      return next;
    });
  }, []);

  const isSaved = useCallback(
    (noticeId: string) => saved.some((o) => o.noticeId === noticeId),
    [saved]
  );

  return { saved, toggle, isSaved };
}
