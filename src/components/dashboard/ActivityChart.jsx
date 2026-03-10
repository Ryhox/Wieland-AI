import { useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend,
} from 'recharts';

function buildDailyData(items, dateKey, days = 30) {
  const now = new Date();
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
    const key = d.toISOString().slice(0, 10);
    result.push({ date: label, _key: key, count: 0 });
  }
  items.forEach(item => {
    const k = item[dateKey]?.slice(0, 10);
    const slot = result.find(r => r._key === k);
    if (slot) slot.count += 1;
  });
  return result;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="db-chart-tooltip">
      <span className="db-chart-tt-label">{label}</span>
      {payload.map(p => (
        <span key={p.dataKey} className="db-chart-tt-val" style={{ color: p.color }}>
          {p.name}: {p.value}
        </span>
      ))}
    </div>
  );
};

export default function ActivityChart({ users, chats, loading }) {
  const userDaily = useMemo(() => buildDailyData(users, 'created_at'), [users]);
  const chatDaily = useMemo(() => buildDailyData(chats, 'created_at'), [chats]);

  const combined = useMemo(() => {
    return userDaily.map((d, i) => ({
      date: d.date,
      Benutzer: d.count,
      Chats: chatDaily[i]?.count ?? 0,
    }));
  }, [userDaily, chatDaily]);

  const msgPerDay = useMemo(() => {
    return chatDaily.map((d, i) => ({
      date: d.date,
      Chats: d.count,
      Benutzer: userDaily[i]?.count ?? 0,
    }));
  }, [chatDaily, userDaily]);

  if (loading) return <div className="db-skeleton" style={{ height: 400, borderRadius: 12 }} />;

  return (
    <div className="db-activity-root">
      <div className="db-chart-card">
        <div className="db-panel-header">
          <span className="db-panel-title">Neue Registrierungen & Chats (30 Tage)</span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={combined} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--db-accent-blue)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--db-accent-blue)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradChats" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--db-accent-violet)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--db-accent-violet)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--db-border)" />
            <XAxis dataKey="date" tick={{ fill: 'var(--db-muted)', fontSize: 11 }} interval={4} />
            <YAxis tick={{ fill: 'var(--db-muted)', fontSize: 11 }} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--db-text)' }} />
            <Area type="monotone" dataKey="Benutzer" stroke="var(--db-accent-blue)" fill="url(#gradUsers)" strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="Chats" stroke="var(--db-accent-violet)" fill="url(#gradChats)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="db-chart-card">
        <div className="db-panel-header">
          <span className="db-panel-title">Tägliche Chat-Erstellung (Balken)</span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={msgPerDay} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--db-border)" />
            <XAxis dataKey="date" tick={{ fill: 'var(--db-muted)', fontSize: 11 }} interval={4} />
            <YAxis tick={{ fill: 'var(--db-muted)', fontSize: 11 }} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--db-text)' }} />
            <Bar dataKey="Chats" fill="var(--db-accent-violet)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Benutzer" fill="var(--db-accent-teal)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="db-activity-totals">
        <div className="db-activity-total-card">
          <span className="db-at-num">{users.length}</span>
          <span className="db-at-label">Benutzer total</span>
        </div>
        <div className="db-activity-total-card">
          <span className="db-at-num">{chats.length}</span>
          <span className="db-at-label">Chats total</span>
        </div>
        <div className="db-activity-total-card">
          <span className="db-at-num">
            {userDaily.reduce((s, d) => s + (d.count > 0 ? 1 : 0), 0)}
          </span>
          <span className="db-at-label">Aktive Tage (User)</span>
        </div>
        <div className="db-activity-total-card">
          <span className="db-at-num">
            {chats.length ? Math.round(chats.reduce((s, c) => s + (c.message_count || 0), 0) / chats.length) : 0}
          </span>
          <span className="db-at-label">Ø Msgs/Chat</span>
        </div>
      </div>
    </div>
  );
}