import { createFileRoute } from "@tanstack/react-router";
import { P2PSettings } from "@/components/Settings";

export const SettingsRoute = createFileRoute("/settings")({
  component: Settings,
});

function Settings() {
  return <P2PSettings />;
}
