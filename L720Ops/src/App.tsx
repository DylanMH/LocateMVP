import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { LoginPage } from "./pages/auth/LoginPage";
import { AuthProvider } from "./contexts/AuthContext";
import { PrivateRoute } from "./components/auth/PrivateRoute";
import { MainLayout } from "./components/layout/MainLayout";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { TechsPage } from "./pages/techs/TechsPage";
import { TechDetailPage } from "./pages/techs/TechDetailPage";
import { MapTicketsPage } from "./pages/maptickets/MapTicketsPage";
import { TicketsPage } from "./pages/tickets/TicketsPage";
import { SimulatorPage } from "./pages/simulator/SimulatorPage";
import { TerritoriesPage } from "./pages/territories/TerritoriesPage";

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds - data refetches automatically when stale
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/*"
              element={
                <PrivateRoute>
                  <MainLayout>
                    <Routes>
                      <Route
                        path="/"
                        element={<Navigate to="/map" replace />}
                      />
                      <Route path="/dashboard" element={<DashboardPage />} />
                      <Route path="/techs" element={<TechsPage />} />
                      <Route path="/techs/:id" element={<TechDetailPage />} />
                      <Route path="/map" element={<MapTicketsPage />} />
                      <Route path="/tickets" element={<TicketsPage />} />
                      <Route path="/territories" element={<TerritoriesPage />} />
                      <Route path="/simulator" element={<SimulatorPage />} />
                    </Routes>
                  </MainLayout>
                </PrivateRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </Router>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export default App;
