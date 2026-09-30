import { Routes, Route, Navigate } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import Dashboard from "./pages/Dashboard";
import Memories from "./pages/Memories";
import SearchPage from "./pages/SearchPage";
import Decisions from "./pages/Decisions";
import SyncPage from "./pages/SyncPage";
import ActivityPage from "./pages/ActivityPage";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/memory" element={<Memories />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/decisions" element={<Decisions />} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster theme="dark" position="bottom-right" />
    </>
  );
}
