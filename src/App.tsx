import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import CriteriaPage from "./pages/CriteriaPage";
import SuitesPage from "./pages/SuitesPage";
import EvaluatePage from "./pages/EvaluatePage";
import GenerationsPage from "./pages/GenerationsPage";
import MappingPage from "./pages/MappingPage";
import CriterionDetailPage from "./pages/CriterionDetailPage";
import DataPage from "./pages/DataPage";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";
import { isAuthenticated } from "@/lib/auth";

const queryClient = new QueryClient();

const RequireAuth = () => {
  const location = useLocation();
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<CriteriaPage />} />
              <Route path="/criteria" element={<CriteriaPage />} />
              <Route path="/suites" element={<SuitesPage />} />
              <Route path="/evaluate" element={<EvaluatePage />} />
              <Route path="/generations" element={<GenerationsPage />} />
              <Route path="/mapping" element={<MappingPage />} />
              <Route path="/data" element={<DataPage />} />
              <Route path="/criteria/:id" element={<CriterionDetailPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
