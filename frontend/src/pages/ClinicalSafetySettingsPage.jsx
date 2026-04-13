import { useEffect } from "react";
import SectionCard from "../components/SectionCard";
import { useAuth } from "../context/AuthContext";

export default function ClinicalSafetySettingsPage() {
  const { openSafetyDrawer } = useAuth();

  useEffect(() => {
    openSafetyDrawer();
  }, [openSafetyDrawer]);

  return (
    <div className="page-stack">
      <SectionCard
        title="Clinical Safety Settings"
        subtitle="Settings now open from the global drawer, so you can adjust them from any page."
      >
        <div className="empty-state">Use the Safety Settings drawer on the right side of the app.</div>
      </SectionCard>
    </div>
  );
}
