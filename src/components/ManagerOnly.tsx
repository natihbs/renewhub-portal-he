import type { ReactNode } from "react";
import { useIsManager } from "@/lib/store";

export function ManagerOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useIsManager() ? <>{children}</> : <>{fallback}</>;
}
