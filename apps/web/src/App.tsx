import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/common/ProtectedRoute';

import { AchievementsPage } from './pages/achievements/AchievementsPage';
import { ConversationPage } from './pages/conversation/ConversationPage';
import { DictationPractice } from './pages/learning/DictationPractice';
import { GamificationPage } from './pages/gamification/GamificationPage';
import { ReportPage } from './pages/report/ReportPage';
import { SpellingPractice } from './pages/learning/SpellingPractice';
import { WordCardPractice } from './pages/learning/WordCardPractice';
import { ErrorBookPage } from './pages/errorbook/ErrorBookPage';
import { HeatmapPage } from './pages/dashboard/HeatmapPage';
import { LoginPage } from './pages/auth/LoginPage';
import { ParentDashboard } from './pages/parent/ParentDashboard';
import { ProfilePage } from './pages/parent/ProfilePage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { StreakPage } from './pages/dashboard/StreakPage';
import { TodayPage } from './pages/dashboard/TodayPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/streak" element={<StreakPage />} />
        <Route path="/heatmap" element={<HeatmapPage />} />
        <Route path="/practice/word-card" element={<WordCardPractice />} />
        <Route path="/practice/spelling" element={<SpellingPractice />} />
        <Route path="/practice/dictation" element={<DictationPractice />} />
        <Route path="/errorbook" element={<ErrorBookPage />} />
        <Route path="/gamification" element={<GamificationPage />} />
        <Route path="/conversation" element={<ConversationPage />} />
        <Route path="/conversation/:conversationId" element={<ConversationPage />} />
        <Route path="/reports" element={<ReportPage />} />
        <Route path="/achievements" element={<AchievementsPage />} />
        <Route path="/parent/dashboard" element={<ParentDashboard />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
