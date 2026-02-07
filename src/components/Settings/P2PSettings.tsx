import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeviceList } from "./DeviceList";
import { PairingCode } from "./PairingCode";

interface Device {
  id: string;
  name: string;
  status: "online" | "offline" | "busy";
  lastSeen: string;
}

export function P2PSettings() {
  const [autoConnect, setAutoConnect] = useState(true);
  const [notifications, setNotifications] = useState(true);

  const devices: Device[] = [
    { id: "1", name: "MacBook Pro", status: "online", lastSeen: "刚刚" },
    { id: "2", name: "iPhone 15", status: "offline", lastSeen: "5分钟前" },
    { id: "3", name: "iPad Air", status: "busy", lastSeen: "刚刚" },
  ];

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">P2P 设置</h2>
          <p className="text-muted-foreground">管理您的设备和连接</p>
        </div>
        <Badge variant="secondary">{devices.filter(d => d.status === "online").length} 在线</Badge>
      </div>

      <Tabs defaultValue="devices" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="devices">设备</TabsTrigger>
          <TabsTrigger value="pairing">配对</TabsTrigger>
          <TabsTrigger value="connection">连接</TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>已连接设备</CardTitle>
              <CardDescription>管理您的 P2P 网络设备</CardDescription>
            </CardHeader>
            <CardContent>
              <DeviceList devices={devices} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pairing" className="space-y-4 mt-4">
          <PairingCode />
        </TabsContent>

        <TabsContent value="connection" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>连接设置</CardTitle>
              <CardDescription>配置 P2P 连接选项</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>自动连接</Label>
                  <p className="text-sm text-muted-foreground">启动时自动连接到 P2P 网络</p>
                </div>
                <Switch checked={autoConnect} onCheckedChange={setAutoConnect} />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>消息通知</Label>
                  <p className="text-sm text-muted-foreground">收到消息时显示通知</p>
                </div>
                <Switch checked={notifications} onCheckedChange={setNotifications} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
