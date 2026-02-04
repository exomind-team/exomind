import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PairingCode() {
  const [pairingCode, setPairingCode] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const generateCode = () => {
    setIsGenerating(true);
    // 模拟生成配对码
    setTimeout(() => {
      setPairingCode(Math.random().toString(36).substring(2, 8).toUpperCase());
      setIsGenerating(false);
    }, 1000);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>生成配对码</CardTitle>
          <CardDescription>创建一个配对码让新设备加入</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center p-6 bg-muted rounded-lg">
            {pairingCode ? (
              <p className="text-4xl font-mono font-bold tracking-widest">{pairingCode}</p>
            ) : (
              <p className="text-muted-foreground">点击下方按钮生成配对码</p>
            )}
          </div>
          <Button
            onClick={generateCode}
            disabled={isGenerating}
            className="w-full"
          >
            {isGenerating ? "生成中..." : "生成新配对码"}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            配对码 5 分钟后过期
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>输入配对码</CardTitle>
          <CardDescription>输入其他设备显示的配对码</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pairing-code">配对码</Label>
            <Input
              id="pairing-code"
              placeholder="输入 6 位配对码"
              maxLength={6}
              className="text-center text-lg font-mono"
            />
          </div>
          <Button className="w-full" disabled={pairingCode.length !== 6}>
            加入设备
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
