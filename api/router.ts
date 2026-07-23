import { authRouter } from "./auth-router";
import { circleRouter } from "./circle-router";
import { adminRouter } from "./admin-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  circle: circleRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
