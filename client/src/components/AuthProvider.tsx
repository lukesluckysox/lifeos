import { createContext, useContext, useEffect, useState, useCallback } from "react";

export interface AuthUser {
  id: number;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  spotifyId: string | null;
  googleId: string | null;
  createdAt: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** @deprecated kept for back-compat — alias of loginWithSpotify */
  login: () => void;
  loginWithSpotify: () => void;
  loginWithGoogle: () => void;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: () => {},
  loginWithSpotify: () => {},
  loginWithGoogle: () => {},
  logout: async () => {},
  refetch: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user ?? null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const loginWithSpotify = useCallback(() => {
    window.location.href = "/api/auth/spotify/login";
  }, []);

  const loginWithGoogle = useCallback(() => {
    window.location.href = "/api/auth/google/login";
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    setUser(null);
    window.location.hash = "#/";
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login: loginWithSpotify, loginWithSpotify, loginWithGoogle, logout, refetch: fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
}
