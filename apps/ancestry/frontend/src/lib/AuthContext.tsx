import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface AuthCtx {
  isEditor: boolean;
  secret: string;
  login: (password: string) => Promise<boolean>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({
  isEditor: false,
  secret: '',
  login: async () => false,
  logout: () => {},
});

const SESSION_KEY = 'ancestry-edit-secret';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [secret, setSecret] = useState<string>(
    () => sessionStorage.getItem(SESSION_KEY) ?? '',
  );

  const login = useCallback(async (password: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/verify', {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (res.ok) {
        sessionStorage.setItem(SESSION_KEY, password);
        setSecret(password);
        return true;
      }
    } catch {
      // network error
    }
    return false;
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setSecret('');
  }, []);

  return (
    <Ctx.Provider value={{ isEditor: secret !== '', secret, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
