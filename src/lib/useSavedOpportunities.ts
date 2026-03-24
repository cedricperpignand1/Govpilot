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

  // Load from server on mount
  useEffect(() => {
    fetch("/api/saved-opportunities")
      .then((r) => r.json())
      .then((data: ScoredOpportunity[]) => {
        const active = data.filter((o) => !isExpired(o));
        // Purge expired ones from the server too
        const expired = data.filter((o) => isExpired(o));
        expired.forEach((o) =>
          fetch(`/api/saved-opportunities?noticeId=${encodeURIComponent(o.noticeId)}`, {
            method: "DELETE",
          })
        );
        setSaved(active);
      })
      .catch(() => {/* ignore network errors */});
  }, []);

  const toggle = useCallback((opp: ScoredOpportunity) => {
    setSaved((prev) => {
      const exists = prev.some((o) => o.noticeId === opp.noticeId);
      if (exists) {
        fetch(`/api/saved-opportunities?noticeId=${encodeURIComponent(opp.noticeId)}`, {
          method: "DELETE",
        });
        return prev.filter((o) => o.noticeId !== opp.noticeId);
      } else {
        fetch("/api/saved-opportunities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opportunity: opp }),
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
