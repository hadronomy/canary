import { createContext, useContext, type ReactNode } from 'react';

const SurfaceContext = createContext<number>(1);

type SurfaceProviderProps = {
  children: ReactNode;
  value: number;
};

function useSurface(): number {
  return useContext(SurfaceContext);
}

function SurfaceProvider({ children, value }: SurfaceProviderProps) {
  return (
    <SurfaceContext.Provider value={Math.max(1, Math.min(8, value))}>
      {children}
    </SurfaceContext.Provider>
  );
}

export { SurfaceProvider, useSurface };
export type { SurfaceProviderProps };
