import { useMemo, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer,
} from 'recharts';

const RANGES = [
  { label: '7T', days: 7 },
  { label: '14T', days: 14 },
  { label: '30T', days: 30 },
  { label: '90T', days: 90 },
];
const TYPES = [
  { id: 'both', label: 'Beides' },
  { id: 'users', label: 'Benutzer' },
  { id: 'chats', label: 'Chats' },
];

const ArrowRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12H19" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

function buildDaily(items, dateKey, days) {
  const now = new Date();
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    result.push({ date: d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }), _key: d.toISOString().slice(0, 10), count: 0 });
  }
  items.forEach(item => {
    const k = item[dateKey]?.slice(0, 10);
    const slot = result.find(r => r._key === k);
    if (slot) slot.count += 1;
  });
  return result;
}

const CTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="db-chart-tooltip">
      <span className="db-chart-tt-label">{label}</span>
      {payload.map(p => (
        <span key={p.dataKey} className="db-chart-tt-val" style={{ color: p.color }}>{p.name}: {p.value}</span>
      ))}
    </div>
  );
};

function StatCard({ label, value, accent, loading, onClick, sublabel }) {
  return (
    <div className={`db-stat-card accent-${accent} ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      {loading ? <div className="db-skeleton db-skeleton-stat" /> : (
        <>
          <span className="db-stat-value">{value ?? '—'}</span>
          <span className="db-stat-label">{label}</span>
          {sublabel && <span className="db-stat-sub">{sublabel}</span>}
          {onClick && <span className="db-stat-arrow"><ArrowRight /></span>}
        </>
      )}
    </div>
  );
}

export default function DBStats({ stats, loading, users, chats, onUserClick, onUserChats, onChatClick, onTabChange }) {
  const [range, setRange] = useState(30);
  const [chartType, setChartType] = useState('both');

  const userDaily = useMemo(() => buildDaily(users, 'created_at', range), [users, range]);
  const chatDaily = useMemo(() => buildDaily(chats, 'created_at', range), [chats, range]);

  const combined = useMemo(() => userDaily.map((d, i) => ({
    date: d.date,
    Benutzer: d.count,
    Chats: chatDaily[i]?.count ?? 0,
  })), [userDaily, chatDaily]);

  const derived = useMemo(() => {
    const planCounts = users.reduce((acc, u) => { acc[u.plan] = (acc[u.plan] || 0) + 1; return acc; }, {});
    const avgMsgs = chats.length ? Math.round(chats.reduce((s, c) => s + (c.message_count || 0), 0) / chats.length) : 0;
    const newest = [...users].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    const topChats = [...chats].sort((a, b) => (b.message_count || 0) - (a.message_count || 0)).slice(0, 6);
    return { planCounts, avgMsgs, newest, topChats };
  }, [users, chats]);

  const fmtDate = d => d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="db-overview">
      <div className="db-stat-grid">
        <StatCard label="Benutzer gesamt" value={stats?.total_users ?? users.length} accent="pink" loading={loading} onClick={() => onTabChange('users')} sublabel="Alle anzeigen" />
        <StatCard label="Chats gesamt" value={stats?.total_chats ?? chats.length} accent="violet" loading={loading} onClick={() => onTabChange('chats')} sublabel="Alle anzeigen" />
        <StatCard label="Nachrichten" value={stats?.total_msgs ?? '—'} accent="blue" loading={loading} />
        <StatCard label="Ø Msgs/Chat" value={derived.avgMsgs} accent="teal" loading={loading} sublabel="Nachrichten pro Chat" />
      </div>

      <div className="db-panel db-chart-panel">
        <div className="db-panel-header">
          <span className="db-panel-title">Neue Registrierungen &amp; Chats</span>
          <div className="db-chart-controls">
            <div className="db-chart-toggle">
              {TYPES.map(t => (
                <button key={t.id} className={`db-toggle-btn ${chartType === t.id ? 'active' : ''}`}
                  onClick={() => setChartType(t.id)}>{t.label}</button>
              ))}
            </div>
            <div className="db-chart-toggle">
              {RANGES.map(r => (
                <button key={r.days} className={`db-toggle-btn ${range === r.days ? 'active' : ''}`}
                  onClick={() => setRange(r.days)}>{r.label}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: '8px 8px 0' }}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={combined} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="gU" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#fa4fc7" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#fa4fc7" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} interval={Math.floor(range / 7)} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} allowDecimals={false} />
              <Tooltip content={<CTip />} />
              {(chartType === 'both' || chartType === 'users') && (
                <Area type="monotone" dataKey="Benutzer" stroke="#fa4fc7" fill="url(#gU)" strokeWidth={2} dot={false} />
              )}
              {(chartType === 'both' || chartType === 'chats') && (
                <Area type="monotone" dataKey="Chats" stroke="#a78bfa" fill="url(#gC)" strokeWidth={2} dot={false} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="db-panels-row">
        <div className="db-panel">
          <div className="db-panel-header">
            <span className="db-panel-title">Plan-Verteilung</span>
            <button className="db-panel-link" onClick={() => onTabChange('users')}>
              Anzeigen <ArrowRight />
            </button>
          </div>
          <div className="db-plan-list">
            {Object.entries(derived.planCounts).map(([plan, count]) => (
              <div key={plan} className="db-plan-row clickable" onClick={() => onTabChange('users')}>
                <span className={`db-plan-badge ${plan.toLowerCase()}`}>{plan}</span>
                <div className="db-plan-bar-track">
                  <div className="db-plan-bar" style={{ width: `${Math.round((count / users.length) * 100)}%` }} />
                </div>
                <span className="db-plan-count">{count}</span>
              </div>
            ))}
            {!Object.keys(derived.planCounts).length && !loading && <span className="db-empty-hint">Keine Daten</span>}
          </div>
        </div>

        <div className="db-panel">
          <div className="db-panel-header">
            <span className="db-panel-title">Neueste Benutzer</span>
            <button className="db-panel-link" onClick={() => onTabChange('users')}>
              Anzeigen <ArrowRight />
            </button>
          </div>
          <div className="db-new-users-list">
            {derived.newest.map(u => (
              <div key={u.id} className="db-new-user-row clickable" onClick={() => onUserClick(u)}>
                <div className="db-avatar sm">{u.username?.[0]?.toUpperCase()}</div>
                <div className="db-new-user-info">
                  <span className="db-new-user-name">{u.username}</span>
                  <span className="db-new-user-email">{u.email}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <span className="db-new-user-date">{fmtDate(u.created_at)}</span>
                  <button className="db-mini-link" onClick={e => { e.stopPropagation(); onUserChats(u); }}>Chats</button>
                </div>
              </div>
            ))}
            {!derived.newest.length && !loading && <span className="db-empty-hint">Keine Benutzer</span>}
          </div>
        </div>

        <div className="db-panel">
          <div className="db-panel-header">
            <span className="db-panel-title">Aktivste Chats</span>
            <button className="db-panel-link" onClick={() => onTabChange('chats')}>
              Anzeigen <ArrowRight />
            </button>
          </div>
          <div className="db-top-chats-list">
            {derived.topChats.map(c => (
              <div key={c.id} className="db-top-chat-row clickable" onClick={() => onChatClick(c)}>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <span className="db-top-chat-title">{c.title || c.filename}</span>
                  {c.username && <span className="db-top-chat-user"> · {c.username}</span>}
                </div>
                <span className="db-top-chat-msgs">{c.message_count ?? 0} Msgs</span>
              </div>
            ))}
            {!chats.length && !loading && <span className="db-empty-hint">Keine Chats</span>}
          </div>
        </div>
      </div>
    </div>
  );
}