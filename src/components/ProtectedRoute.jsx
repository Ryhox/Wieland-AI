import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, requiredPlan = null }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', color: 'rgba(255,255,255,0.6)', fontSize: 14,
        background: '#0a0b0f',
      }}>
        Laden…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  if (requiredPlan && user.plan !== requiredPlan) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return children;
}