import { createRouter, scopedAdmin } from "../middleware";
import { atRiskReport } from "../queries/reports";

export const memberSuccessRouter = createRouter({
  reportsAtRisk: scopedAdmin("member_success").query(() => atRiskReport()),
});
