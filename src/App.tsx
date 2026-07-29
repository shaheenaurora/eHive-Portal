import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CookieConsent } from "@/components/CookieConsent";

/* Eager: the auth entry screens (small, needed immediately). */
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

/* Lazy: every portal/admin page is code-split so first paint ships only what
   the current route needs (keeps the initial bundle small on 4G). */
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));

const Gate = lazy(() => import("./pages/portal/Gate"));
const Apply = lazy(() => import("./pages/portal/Apply"));
const Status = lazy(() => import("./pages/portal/Status"));
const Dashboard = lazy(() => import("./pages/portal/Dashboard"));
const Pods = lazy(() => import("./pages/portal/Pods"));
const PodDetail = lazy(() => import("./pages/portal/PodDetail"));
const Events = lazy(() => import("./pages/portal/Events"));
const Connect = lazy(() => import("./pages/portal/Connect"));
const Chapter = lazy(() => import("./pages/portal/Chapter"));
const Score = lazy(() => import("./pages/portal/Score"));
const Frp = lazy(() => import("./pages/portal/Frp"));
const Governance = lazy(() => import("./pages/portal/Governance"));
const Library = lazy(() => import("./pages/portal/Library"));
const Offers = lazy(() => import("./pages/portal/Offers"));
const Membership = lazy(() => import("./pages/portal/Membership"));

const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminApplications = lazy(() => import("./pages/admin/AdminApplications"));
const AdminMembers = lazy(() => import("./pages/admin/AdminMembers"));
const AdminMemberDetail = lazy(() => import("./pages/admin/AdminMemberDetail"));
const AdminPods = lazy(() => import("./pages/admin/AdminPods"));
const AdminPodDetail = lazy(() => import("./pages/admin/AdminPodDetail"));
const AdminEvents = lazy(() => import("./pages/admin/AdminEvents"));
const AdminScore = lazy(() => import("./pages/admin/AdminScore"));
const AdminFrp = lazy(() => import("./pages/admin/AdminFrp"));
const AdminGovernance = lazy(() => import("./pages/admin/AdminGovernance"));
const AdminLibrary = lazy(() => import("./pages/admin/AdminLibrary"));
const AdminOffers = lazy(() => import("./pages/admin/AdminOffers"));
const AdminLeads = lazy(() => import("./pages/admin/AdminLeads"));
const AdminEngagement = lazy(() => import("./pages/admin/AdminEngagement"));
const AdminConnect = lazy(() => import("./pages/admin/AdminConnect"));
const AdminAdmissions = lazy(() => import("./pages/admin/AdminAdmissions"));
const AdminChapters = lazy(() => import("./pages/admin/AdminChapters"));
const AdminInsights = lazy(() => import("./pages/admin/AdminInsights"));
const AdminNewsletters = lazy(() => import("./pages/admin/AdminNewsletters"));
const AdminAccess = lazy(() => import("./pages/admin/AdminAccess"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit"));
const AdminConduct = lazy(() => import("./pages/admin/AdminConduct"));

function RouteFallback() {
  return <div className="eh-spin" role="status" aria-label="Loading" />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/portal" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          {/* member portal */}
          <Route path="/portal" element={<Gate />} />
          <Route path="/portal/apply" element={<Apply />} />
          <Route path="/portal/status" element={<Status />} />
          <Route path="/portal/dashboard" element={<Dashboard />} />
          <Route path="/portal/pods" element={<Pods />} />
          <Route path="/portal/pods/:id" element={<PodDetail />} />
          <Route path="/portal/events" element={<Events />} />
          <Route path="/portal/connect" element={<Connect />} />
          <Route path="/portal/chapter" element={<Chapter />} />
          <Route path="/portal/score" element={<Score />} />
          <Route path="/portal/frp" element={<Frp />} />
          <Route path="/portal/governance" element={<Governance />} />
          <Route path="/portal/library" element={<Library />} />
          <Route path="/portal/offers" element={<Offers />} />
          <Route path="/portal/membership" element={<Membership />} />

          {/* admin portal */}
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/applications" element={<AdminApplications />} />
          <Route path="/admin/members" element={<AdminMembers />} />
          <Route path="/admin/members/:id" element={<AdminMemberDetail />} />
          <Route path="/admin/pods" element={<AdminPods />} />
          <Route path="/admin/pods/:id" element={<AdminPodDetail />} />
          <Route path="/admin/events" element={<AdminEvents />} />
          <Route path="/admin/score" element={<AdminScore />} />
          <Route path="/admin/frp" element={<AdminFrp />} />
          <Route path="/admin/governance" element={<AdminGovernance />} />
          <Route path="/admin/library" element={<AdminLibrary />} />
          <Route path="/admin/offers" element={<AdminOffers />} />
          <Route path="/admin/leads" element={<AdminLeads />} />
          <Route path="/admin/engagement" element={<AdminEngagement />} />
          <Route path="/admin/connect" element={<AdminConnect />} />
          <Route path="/admin/admissions" element={<AdminAdmissions />} />
          <Route path="/admin/chapters" element={<AdminChapters />} />
          <Route path="/admin/insights" element={<AdminInsights />} />
          <Route path="/admin/newsletters" element={<AdminNewsletters />} />
          <Route path="/admin/access" element={<AdminAccess />} />
          <Route path="/admin/audit" element={<AdminAudit />} />
          <Route path="/admin/conduct" element={<AdminConduct />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <CookieConsent />
    </ErrorBoundary>
  );
}
