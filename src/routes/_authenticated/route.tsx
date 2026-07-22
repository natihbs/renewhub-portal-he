import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }
    // Enforce "must change password" if flagged on the profile.
    const { data: profile } = await supabase
      .from("profiles")
      .select("must_change_password, active")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profile?.active === false) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    if (profile?.must_change_password) {
      throw redirect({ to: "/reset-password" });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
