"use client";

import { useState, useEffect, useCallback } from "react";
import { ScoredOpportunity } from "./types";

function isExpired(opp: ScoredOpportunity): boolean {
  const raw = opp.responseDeadLine ?? opp.reponseDeadLine;
  if (!raw) return false;
  const d = new Date(raw);
  return !isNaN(d.getTime()) && d.getTime() < Date.now();
}

export function useSavedOpportunities() {
  const [saved, setSaved] = useState<ScoredOpportunity[]>([]);

  useEffect(() => {
    fetch("/api/saved-opportunities")
      .then((r) => {
        if (!r.ok) throw new Error(`GET failed: ${r.status}`);
        return r.json();
      })
      .then((data: ScoredOpportunity[]) => {
        console.log("[saved opps] loaded from server:", data.length);
        const active = data.filter((o) => !isExpired(o));
        const expired = data.filter((o) => isExpired(o));
        expired.forEach((o) =>
          fetch(`/api/saved-opportunities?noticeId=${encodeURIComponent(o.noticeId)}`, {
            method: "DELETE",
          })
        );
        setSaved(active);
      })
      .catch((err) => console.error("[saved opps] load error:", err));
  }, []);

  const toggle = useCallback((opp: ScoredOpportunity) => {
    setSaved((prev) => {
      const exists = prev.some((o) => o.noticeId === opp.noticeId);
      if (exists) {
        fetch(`/api/saved-opportunities?noticeId=${encodeURIComponent(opp.noticeId)}`, {
          method: "DELETE",
        }).then((r) => {
          if (!r.ok) console.error("[saved opps] DELETE failed:", r.status);
          else console.log("[saved opps] deleted:", opp.noticeId);
        });
        return prev.filter((o) => o.noticeId !== opp.noticeId);
      } else {
        fetch("/api/saved-opportunities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opportunity: opp }),
        }).then((r) => {
          if (!r.ok) r.text().then((t) => console.error("[saved opps] POST failed:", r.status, t));
          else console.log("[saved opps] saved:", opp.noticeId);
        });
        return [...prev, opp];
      }
    });
  }, []);

  const isSaved = useCallback(
    (noticeId: string) => saved.some((o) => o.noticeId === noticeId),
    [saved]
  );

  return { saved, toggle, isSaved };
}
