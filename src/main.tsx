import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/Login';
import { ChangePasswordPage } from './pages/ChangePassword';
import { ProtectedLayout } from './components/Layout';
import { DashboardPage } from './pages/Dashboard';
import { PropertiesPage } from './pages/Properties';
import { TenantsPage } from './pages/Tenants';
import { ContractsPage } from './pages/Contracts';
import { PaymentsPage } from './pages/Payments';
import { CostStatementsPage } from './pages/CostStatements';
import { ApiTokensPage } from './pages/ApiTokens';
import { ContractDetailPage } from './pages/ContractDetail';
import { ReconciliationDetailPage } from './pages/ReconciliationDetail';
import { PropertyDetailPage } from './pages/PropertyDetail';
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
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/properties" element={<PropertiesPage />} />
            <Route path="/tenants" element={<TenantsPage />} />
            <Route path="/contracts" element={<ContractsPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/cost-statements" element={<CostStatementsPage />} />
            <Route path="/settings/api-tokens" element={<ApiTokensPage />} />
            <Route path="/contracts/:id" element={<ContractDetailPage />} />
            <Route path="/reconciliations/:id" element={<ReconciliationDetailPage />} />
            <Route path="/properties/:id" element={<PropertyDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
