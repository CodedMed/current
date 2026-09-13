import { Navigate, Route, Routes } from 'react-router';
import { VoiceDock } from './components/advisor/VoiceDock.tsx';
import { StepRoute } from './components/StepRoute.tsx';
import { SessionProvider } from './lib/session.tsx';
import AdvisorPage from './pages/AdvisorPage.tsx';
import AccountsPage from './pages/workspace/AccountsPage.tsx';
import FinancingPage from './pages/workspace/FinancingPage.tsx';
import ForecastPage from './pages/workspace/ForecastPage.tsx';
import OverviewPage from './pages/workspace/OverviewPage.tsx';
import ReportsPage from './pages/workspace/ReportsPage.tsx';
import TransactionsPage from './pages/workspace/TransactionsPage.tsx';
import WorkspaceLayout from './pages/workspace/WorkspaceLayout.tsx';
import DocumentsPage from './pages/DocumentsPage.tsx';
import TasksPage from './pages/TasksPage.tsx';
import SignUpPage from './pages/SignUpPage.tsx';
import VerifyIdentityPage from './pages/VerifyIdentityPage.tsx';
import BusinessTypePage from './pages/onboarding/BusinessTypePage.tsx';
import FeaturesPage from './pages/onboarding/FeaturesPage.tsx';
import SetupPage from './pages/onboarding/SetupPage.tsx';

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route
          path="/"
          element={
            <StepRoute step="signup">
              <SignUpPage />
            </StepRoute>
          }
        />
        <Route
          path="/verify"
          element={
            <StepRoute step="verify">
              <VerifyIdentityPage />
            </StepRoute>
          }
        />
        <Route
          path="/onboarding/business-type"
          element={
            <StepRoute step="business-type">
              <BusinessTypePage />
            </StepRoute>
          }
        />
        <Route
          path="/onboarding/features"
          element={
            <StepRoute step="features">
              <FeaturesPage />
            </StepRoute>
          }
        />
        <Route
          path="/onboarding/setup"
          element={
            <StepRoute step="setup">
              <SetupPage />
            </StepRoute>
          }
        />
        {/* One layout, one dashboard request; each section is its own page underneath it. */}
        <Route
          path="/dashboard"
          element={
            <StepRoute step="dashboard">
              <WorkspaceLayout />
            </StepRoute>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="forecast" element={<ForecastPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="financing" element={<FinancingPage />} />
        </Route>
        {/* The advisor is part of the workspace: same gate as the dashboard. */}
        <Route
          path="/advisor"
          element={
            <StepRoute step="dashboard">
              <AdvisorPage />
            </StepRoute>
          }
        />
        <Route path="/documents" element={<StepRoute step="dashboard"><DocumentsPage /></StepRoute>} />
        <Route path="/invoices" element={<Navigate to="/documents" replace />} />
        <Route path="/tasks" element={<StepRoute step="dashboard"><TasksPage /></StepRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* Talk to the advisor from any workspace page; hides itself on /advisor, which has its own. */}
      <VoiceDock />
    </SessionProvider>
  );
}
