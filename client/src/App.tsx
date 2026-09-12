import { Navigate, Route, Routes } from 'react-router';
import { StepRoute } from './components/StepRoute.tsx';
import { SessionProvider } from './lib/session.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
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
        <Route
          path="/dashboard"
          element={
            <StepRoute step="dashboard">
              <DashboardPage />
            </StepRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
