"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

interface UserProfile {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: "ADMIN" | "USER";
  allowedModels: string[];
}

interface NavContextType {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  currentUser: UserProfile | null;
  refreshUser: () => Promise<void>;
  isLoadingUser: boolean;
}

const NavContext = createContext<NavContextType>({
  mobileOpen: false,
  setMobileOpen: () => {},
  currentUser: null,
  refreshUser: async () => {},
  isLoadingUser: true,
});

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);

  const refreshUser = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user);
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setIsLoadingUser(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  return (
    <NavContext.Provider
      value={{
        mobileOpen,
        setMobileOpen,
        currentUser,
        refreshUser,
        isLoadingUser,
      }}
    >
      {children}
    </NavContext.Provider>
  );
}

export function useNav() {
  return useContext(NavContext);
}
