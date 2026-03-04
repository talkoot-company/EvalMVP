import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import CriteriaPage from "./pages/CriteriaPage";
import SuitesPage from "./pages/SuitesPage";
import EvaluatePage from "./pages/EvaluatePage";
import CopiesPage from "./pages/CopiesPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<CriteriaPage />} />
            <Route path="/criteria" element={<CriteriaPage />} />
            <Route path="/suites" element={<SuitesPage />} />
            <Route path="/evaluate" element={<EvaluatePage />} />
            <Route path="/copies" element={<CopiesPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
