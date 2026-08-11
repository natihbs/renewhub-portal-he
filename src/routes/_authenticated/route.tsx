import { createFileRoute, Outlet, redirect, isRedirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { resolveAuthenticatedGuard } from "@/lib/authenticated-guard";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const outcome = await resolveAuthenticatedGuard({
        getUser: async () => {
          const { data, error } = await supabase.auth.getUser();
          return { user: data.user, error };
        },
        getProfile: async (userId) => {
          const { data, error } = await supabase
            .from("profiles")
            .select("must_change_password, active")
            .eq("id", userId)
            .maybeSingle();
          if (error) throw error;
          return data;
        },
        signOut: async () => {
          await supabase.auth.signOut();
        },
      });

      if (outcome.kind === "redirect") throw redirect({ to: outcome.to });
      return { user: outcome.user };
    } catch (error) {
      if (isRedirect(error)) throw error;
      // Last-resort net: nothing here may reach the root error boundary.
      console.error("[Pulse] auth gate failed unexpectedly", error);
      throw redirect({ to: "/auth" });
    }
  },
  component: () => <Outlet />,
});
