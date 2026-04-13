import { createContext, useContext, useEffect, useState } from "react";

const AuthContext = createContext(null);
const STORAGE_KEY = "clinician-auth";
const SAFETY_SETTINGS_KEY = "clinical-safety-settings";

const defaultSafetySettings = {
  ddiStrictness: "standard",
  drugDiseaseStrictness: "full",
};

export function AuthProvider({ children }) {
  const [doctor, setDoctor] = useState(null);
  const [token, setToken] = useState("");
  const [safetySettings, setSafetySettings] = useState(defaultSafetySettings);
  const [isSafetyDrawerOpen, setIsSafetyDrawerOpen] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      setDoctor(parsed.doctor || null);
      setToken(parsed.token || "");
    }

    const storedSafetySettings = localStorage.getItem(SAFETY_SETTINGS_KEY);
    if (storedSafetySettings) {
      const parsedSettings = JSON.parse(storedSafetySettings);
      setSafetySettings({
        ddiStrictness: parsedSettings.ddiStrictness || defaultSafetySettings.ddiStrictness,
        drugDiseaseStrictness: parsedSettings.drugDiseaseStrictness || defaultSafetySettings.drugDiseaseStrictness,
      });
    }
  }, []);

  useEffect(() => {
    if (!toast?.message) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, toast.durationMs || 3200);

    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = (message, options = {}) => {
    if (!message) {
      return;
    }

    setToast({
      message,
      tone: options.tone || "success",
      durationMs: options.durationMs || 3200,
    });
  };

  const clearToast = () => setToast(null);

  const login = (payload) => {
    setDoctor(payload.doctor);
    setToken(payload.token || "");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  };

  const logout = () => {
    setDoctor(null);
    setToken("");
    localStorage.removeItem(STORAGE_KEY);
  };

  const updateSafetySettings = (nextSettings) => {
    const normalized = {
      ddiStrictness: nextSettings.ddiStrictness || defaultSafetySettings.ddiStrictness,
      drugDiseaseStrictness: nextSettings.drugDiseaseStrictness || defaultSafetySettings.drugDiseaseStrictness,
    };
    setSafetySettings(normalized);
    localStorage.setItem(SAFETY_SETTINGS_KEY, JSON.stringify(normalized));
  };

  const resetSafetySettings = () => {
    setSafetySettings(defaultSafetySettings);
    localStorage.setItem(SAFETY_SETTINGS_KEY, JSON.stringify(defaultSafetySettings));
  };

  const openSafetyDrawer = () => setIsSafetyDrawerOpen(true);
  const closeSafetyDrawer = () => setIsSafetyDrawerOpen(false);
  const toggleSafetyDrawer = () => setIsSafetyDrawerOpen((current) => !current);

  return (
    <AuthContext.Provider
      value={{
        doctor,
        token,
        login,
        logout,
        safetySettings,
        updateSafetySettings,
        resetSafetySettings,
        defaultSafetySettings,
        isSafetyDrawerOpen,
        openSafetyDrawer,
        closeSafetyDrawer,
        toggleSafetyDrawer,
        toast,
        showToast,
        clearToast,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
