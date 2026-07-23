import { Routes, Route, Navigate } from "react-router";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

/* member portal */
import Gate from "./pages/portal/Gate";
import Apply from "./pages/portal/Apply";
import Status from "./pages/portal/Status";
import Dashboard from "./pages/portal/Dashboard";
import Pods from "./pages/portal/Pods";
import PodDetail from "./pages/portal/PodDetail";
import Events from "./pages/portal/Events";
import Score from "./pages/portal/Score";
import Frp from "./pages/portal/Frp";
import Governance from "./pages/portal/Governance";
import Library from "./pages/portal/Library";
import Offers from "./pages/portal/Offers";
import Membership from "./pages/portal/Membership";

/* admin portal */
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminApplications from "./pages/admin/AdminApplications";
import AdminMembers from "./pages/admin/AdminMembers";
import AdminMemberDetail from "./pages/admin/AdminMemberDetail";
import AdminPods from "./pages/admin/AdminPods";
import AdminPodDetail from "./pages/admin/AdminPodDetail";
import AdminEvents from "./pages/admin/AdminEvents";
import AdminScore from "./pages/admin/AdminScore";
import AdminFrp from "./pages/admin/AdminFrp";
import AdminGovernance from "./pages/admin/AdminGovernance";
import AdminLibrary from "./pages/admin/AdminLibrary";
import AdminOffers from "./pages/admin/AdminOffers";
import AdminLeads from "./pages/admin/AdminLeads";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/portal" replace />} />
      <Route path="/login" element={<Login />} />

      {/* member portal */}
      <Route path="/portal" element={<Gate />} />
      <Route path="/portal/apply" element={<Apply />} />
      <Route path="/portal/status" element={<Status />} />
      <Route path="/portal/dashboard" element={<Dashboard />} />
      <Route path="/portal/pods" element={<Pods />} />
      <Route path="/portal/pods/:id" element={<PodDetail />} />
      <Route path="/portal/events" element={<Events />} />
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

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
