import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AppShell({ children }) {
  const { doctor, logout } = useAuth();
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
          <Link className={location.pathname.startsWith("/settings") ? "active" : ""} to="/settings">
            Clinical Safety Settings
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
      <main className="content">{children}</main>
    </div>
  );
}

