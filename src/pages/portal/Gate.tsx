import { useEffect } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Spinner } from "@/components/eh";

/* Entry: routes the signed-in user to Apply, Application status, or Dashboard */
export default function Gate() {
  const navigate = useNavigate();
  const me = trpc.circle.me.useQuery(undefined, { retry: false });

  useEffect(() => {
    if (!me.data) return;
    const { member, application } = me.data;
    if (member) navigate("/portal/dashboard", { replace: true });
    else if (application && ["received", "screening", "interview"].includes(application.status))
      navigate("/portal/status", { replace: true });
    else navigate("/portal/apply", { replace: true });
  }, [me.data, navigate]);

  if (me.error) {
    return (
      <div className="eh-empty" style={{ paddingTop: "6rem" }}>
        <div className="big">Something went wrong loading your account.</div>
        <p>Please refresh, or sign out and back in.</p>
      </div>
    );
  }
  return <Spinner />;
}
