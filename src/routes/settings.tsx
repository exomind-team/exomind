import { createFileRoute } from "@tanstack/react-router";

export const SettingsRoute = createFileRoute("/settings")({
  component: Settings,
});

function Settings() {
  return (
    <div className="p-2">
      <h3 className="text-lg font-medium">设置</h3>
      <p className="text-muted-foreground">P2P 和设备管理设置</p>
    </div>
  );
}
