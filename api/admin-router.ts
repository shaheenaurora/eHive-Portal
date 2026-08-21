import { mergeRouters } from "./middleware";
import { systemRouter } from "./admin/system";
import { membershipRouter } from "./admin/membership";
import { communityRouter } from "./admin/community";
import { eventsRouter } from "./admin/events";
import { chaptersRouter } from "./admin/chapters";
import { contentRouter } from "./admin/content";
import { partnershipsRouter } from "./admin/partnerships";
import { financeRouter } from "./admin/finance";
import { memberSuccessRouter } from "./admin/member-success";

export const adminRouter = mergeRouters(
  systemRouter,
  membershipRouter,
  communityRouter,
  eventsRouter,
  chaptersRouter,
  contentRouter,
  partnershipsRouter,
  financeRouter,
  memberSuccessRouter
);
