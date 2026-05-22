import { useState, useEffect, useCallback } from "react";
import type { BaseLocationHook } from "wouter";

/**
 * Hash-based location hook that ignores query strings during route matching.
 *
 * Standard wouter hash routing treats `/watch?tab=film` as a different path
 * than `/watch`, breaking our tab system. This hook returns just the path
 * portion to wouter, while preserving the query in the actual URL so
 * `useTabParam` can read it.
 */
export const useHashLocationWithQuery: BaseLocationHook = () => {
  const getHashPath = useCallback(() => {
    const hash = window.location.hash.replace(/^#/, "") || "/";
    const qIdx = hash.indexOf("?");
    return qIdx === -1 ? hash : hash.slice(0, qIdx);
  }, []);

  const [path, setPath] = useState<string>(getHashPath);

  useEffect(() => {
    const handler = () => setPath(getHashPath());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, [getHashPath]);

  const navigate = useCallback(
    (to: string, options?: { replace?: boolean }) => {
      const target = to.startsWith("/") ? `#${to}` : `#/${to}`;
      if (options?.replace) {
        window.history.replaceState(null, "", target);
        // replaceState doesn't fire hashchange — fire it manually
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } else {
        window.location.hash = target.slice(1);
      }
    },
    [],
  );

  return [path, navigate];
};
