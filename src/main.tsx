import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
import { ProtectedLayout } from './components/Layout';
import { DashboardPage } from './pages/Dashboard';
import { PropertiesPage } from './pages/Properties';
import { TenantsPage } from './pages/Tenants';
import { ContractsPage } from './pages/Contracts';
import { PaymentsPage } from './pages/Payments';
import { CostStatementsPage } from './pages/CostStatements';
import { ReconciliationsPage } from './pages/Reconciliations';
import { ApiTokensPage } from './pages/ApiTokens';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/properties" element={<PropertiesPage />} />
            <Route path="/tenants" element={<TenantsPage />} />
            <Route path="/contracts" element={<ContractsPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/cost-statements" element={<CostStatementsPage />} />
            <Route path="/reconciliations" element={<ReconciliationsPage />} />
            <Route path="/settings/api-tokens" element={<ApiTokensPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
