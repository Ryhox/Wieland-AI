import '../styles/LoadingAnimation.css';

export default function LoadingAnimation({ isVisible }) {
  return (
    <div className={`loading-overlay ${!isVisible ? 'hidden' : ''}`}>
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p className="loading-text">Loading...</p>
      </div>
    </div>
  );
}
