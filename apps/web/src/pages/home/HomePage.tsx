import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { Card, StatCard } from '../../components/ui/Card';

export function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">欢迎回来 👋</h1>
        <p className="mt-1 text-slate-500">今天也要加油鸭！</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="今日已学" value="—" icon="📚" accent="primary" />
        <StatCard label="当前连击" value="—" icon="🔥" accent="warning" />
        <StatCard label="今日 XP" value="—" icon="⭐" accent="success" />
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">快速开始练习</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link to="/practice/word-card" className="rounded-xl border border-slate-200 p-4 hover:border-primary-300 hover:bg-primary-50 transition">
            <p className="text-2xl">🃏</p>
            <p className="mt-2 font-semibold text-slate-900">词卡复习</p>
            <p className="mt-1 text-sm text-slate-500">翻卡看释义，掌握词义</p>
          </Link>
          <Link to="/practice/spelling" className="rounded-xl border border-slate-200 p-4 hover:border-primary-300 hover:bg-primary-50 transition">
            <p className="text-2xl">⌨️</p>
            <p className="mt-2 font-semibold text-slate-900">单词拼写</p>
            <p className="mt-1 text-sm text-slate-500">看中文提示输入拼写</p>
          </Link>
          <Link to="/practice/dictation" className="rounded-xl border border-slate-200 p-4 hover:border-primary-300 hover:bg-primary-50 transition">
            <p className="text-2xl">✍️</p>
            <p className="mt-2 font-semibold text-slate-900">句子听写</p>
            <p className="mt-1 text-sm text-slate-500">听译英文，练听力表达</p>
          </Link>
        </div>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => window.location.assign('/today')}>
            查看今日概览 →
          </Button>
        </div>
      </Card>
    </div>
  );
}
