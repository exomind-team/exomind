import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Device {
  id: string;
  name: string;
  status: "online" | "offline" | "busy";
  lastSeen: string;
}

interface DeviceListProps {
  devices: Device[];
}

const statusColors = {
  online: "bg-green-500",
  offline: "bg-gray-400",
  busy: "bg-yellow-500",
};

export function DeviceList({ devices }: DeviceListProps) {
  return (
    <div className="space-y-4">
      {devices.map((device) => (
        <div
          key={device.id}
          className="flex items-center justify-between p-4 border rounded-lg"
        >
          <div className="flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${statusColors[device.status]}`} />
            <div>
              <p className="font-medium">{device.name}</p>
              <p className="text-sm text-muted-foreground">
                最后活跃: {device.lastSeen}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={device.status === "online" ? "default" : "secondary"}>
              {device.status === "online" ? "在线" : device.status === "offline" ? "离线" : "忙碌"}
            </Badge>
            <Button variant="outline" size="sm">
              管理
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
