import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from './components/common/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { AchievementsPage } from './pages/achievements/AchievementsPage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ConversationPage } from './pages/conversation/ConversationPage';
import { HeatmapPage } from './pages/dashboard/HeatmapPage';
import { StreakPage } from './pages/dashboard/StreakPage';
import { TodayPage } from './pages/dashboard/TodayPage';
import { ErrorBookPage } from './pages/errorbook/ErrorBookPage';
import { Match4Game } from './pages/games/Match4Game';
import { MinerGame } from './pages/games/MinerGame';
import { SpellTruckGame } from './pages/games/SpellTruckGame';
import { WordShooterGame } from './pages/games/WordShooterGame';
import { GamificationPage } from './pages/gamification/GamificationPage';
import { DictationPractice } from './pages/learning/DictationPractice';
import { ShadowingPractice } from './pages/learning/ShadowingPractice';
import { SpellingPractice } from './pages/learning/SpellingPractice';
import { WordCardPractice } from './pages/learning/WordCardPractice';
import { ParentDashboard } from './pages/parent/ParentDashboard';
import { ProfilePage } from './pages/parent/ProfilePage';
import { ReportPage } from './pages/report/ReportPage';

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
        <Route path="/practice/shadowing" element={<ShadowingPractice />} />
        <Route path="/errorbook" element={<ErrorBookPage />} />
        <Route path="/gamification" element={<GamificationPage />} />
        <Route path="/game/word-shooter" element={<WordShooterGame />} />
        <Route path="/game/spell-truck" element={<SpellTruckGame />} />
        <Route path="/game/miner" element={<MinerGame />} />
        <Route path="/game/match4" element={<Match4Game />} />
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
