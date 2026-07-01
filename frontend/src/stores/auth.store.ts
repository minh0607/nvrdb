import { create } from 'zustand';
import { api } from '../lib/api';

interface TokenPayload {
  userId: number;
  username: string;
  role: 'admin' | 'viewer';
  exp?: number;
}

/**
 * Decode the JWT payload client-side to recover username/role after a page
 * reload (the token lives in localStorage but the store state does not). Returns
 * null for a missing, malformed, or expired token. This is NOT a security check
 * — the backend still verifies the signature on every request; it only restores
 * UI role state so an admin isn't bounced from /admin after refresh.
 */
function decodeToken(token: string | null): TokenPayload | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(b64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    const payload = JSON.parse(json) as TokenPayload;
    if (payload.exp && payload.exp * 1000 <= Date.now()) return null;
    if (payload.role !== 'admin' && payload.role !== 'viewer') return null;
    return payload;
  } catch {
    return null;
  }
}

const initialSession = decodeToken(api.getToken());

interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
  role: 'admin' | 'viewer' | null;
  isLoading: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: !!initialSession,
  username: initialSession?.username ?? null,
  role: initialSession?.role ?? null,
  isLoading: false,
  error: null,

  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.login(username, password);
      set({
        isAuthenticated: true,
        username: result.user.username,
        role: result.user.role,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Login failed',
      });
      throw err;
    }
  },

  logout: () => {
    api.logout();
    set({
      isAuthenticated: false,
      username: null,
      role: null,
    });
  },

  checkAuth: () => {
    const session = decodeToken(api.getToken());
    if (!session) {
      api.logout();
      set({ isAuthenticated: false, username: null, role: null });
    } else {
      set({ isAuthenticated: true, username: session.username, role: session.role });
    }
  },
}));
