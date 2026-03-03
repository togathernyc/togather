/**
 * EnvironmentProvider
 *
 * Provides environment configuration to the app via React context.
 * Environment is determined at build time - no runtime switching.
 */

import React, { createContext, useContext } from "react";
import { Environment, EnvironmentConfig } from "@services/environment";

interface EnvironmentContextValue {
  config: EnvironmentConfig;
  isStaging: boolean;
  isProduction: boolean;
}

const EnvironmentContext = createContext<EnvironmentContextValue | null>(null);

interface EnvironmentProviderProps {
  children: React.ReactNode;
}

export function EnvironmentProvider({ children }: EnvironmentProviderProps) {
  // Environment is determined at build time - no async loading needed
  const value: EnvironmentContextValue = {
    config: Environment.current,
    isStaging: Environment.isStaging(),
    isProduction: Environment.isProduction(),
  };

  return (
    <EnvironmentContext.Provider value={value}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment(): EnvironmentContextValue {
  const context = useContext(EnvironmentContext);
  if (!context) {
    throw new Error("useEnvironment must be used within an EnvironmentProvider");
  }
  return context;
}
