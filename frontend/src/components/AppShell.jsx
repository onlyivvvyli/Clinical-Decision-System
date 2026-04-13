import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import SafetySettingsPanel from "./SafetySettingsPanel";

export default function AppShell({ children }) {
  const {
    doctor,
    logout,
    isSafetyDrawerOpen,
    openSafetyDrawer,
    closeSafetyDrawer,
    toast,
    clearToast,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Prescribing Safety</p>
          <h1>Clinician Console</h1>
        </div>
        <nav className="sidebar-nav">
          <Link className={location.pathname.startsWith("/dashboard") ? "active" : ""} to="/dashboard">
            Dashboard
          </Link>
          <Link className={location.pathname.startsWith("/patients") ? "active" : ""} to="/patients">
            Patients
          </Link>
          <Link className={location.pathname.startsWith("/knowledge-graph") ? "active" : ""} to="/knowledge-graph">
            Knowledge Graph Search
          </Link>
        </nav>
        <div className="sidebar-footer">
          <div className="doctor-card">
            <span>Signed in</span>
            <strong>{doctor?.name}</strong>
            <small>{doctor?.username}</small>
          </div>
          <button className="ghost-button" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="content">
        {toast?.message ? (
          <div className={`global-toast ${toast.tone || "success"}`} role="status" aria-live="polite">
            <span>{toast.message}</span>
            <button type="button" className="global-toast-close" onClick={clearToast} aria-label="Dismiss notification">
              x
            </button>
          </div>
        ) : null}
        {children}
      </main>

      <button type="button" className="safety-drawer-trigger" onClick={openSafetyDrawer}>
        Safety Settings
      </button>

      {isSafetyDrawerOpen ? <button type="button" className="safety-drawer-backdrop" onClick={closeSafetyDrawer} aria-label="Close safety settings" /> : null}

      <aside className={`safety-drawer ${isSafetyDrawerOpen ? "open" : ""}`} aria-hidden={!isSafetyDrawerOpen}>
        <div className="safety-drawer-topbar">
          <div>
            <p className="eyebrow neutral">Global Controls</p>
            <h2>Clinical Safety Settings</h2>
          </div>
          <button type="button" className="ghost-button close-action" onClick={closeSafetyDrawer}>
            Close
          </button>
        </div>

        <SafetySettingsPanel compact onApplyComplete={closeSafetyDrawer} />
      </aside>
    </div>
  );
}
