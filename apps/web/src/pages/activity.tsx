import { Activity } from "lucide-react";

import { PlaceholderPage } from "./placeholder";

export function ActivityPage() {
  return (
    <PlaceholderPage
      title="Aktivitas"
      subtitle="Jejak audit dan perubahan data"
      description="Audit log aktivitas akan tersedia pada tahap rekap dan audit."
      icon={Activity}
    />
  );
}
