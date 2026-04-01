import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from '@tanstack/react-router';
import { useSyncStore } from '@/ui/stores/sync-store';

export function SyncTestPage() {
  const isLoggedIn = useSyncStore((state) => state.isLoggedIn);
  const currentUser = useSyncStore((state) => state.currentUser);
  const activeProfileId = useSyncStore((state) => state.activeProfileId);
  const credentials = useSyncStore((state) => state.credentials);

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">RT 同步状态</h1>
        <p className="text-sm text-muted-foreground">
          旧的 Pouch 同步测试入口已下线。当前多设备同步主路径是“设备配对 + RT Net + RT SQLite”。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>当前档案</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={isLoggedIn ? 'default' : 'destructive'}>
              {isLoggedIn ? '已打开本地档案' : '未打开本地档案'}
            </Badge>
            {currentUser ? <span>{currentUser}</span> : null}
          </div>
          <p>activeProfileId: {activeProfileId ?? '未选择'}</p>
          <p>remoteIdentityKey: {credentials?.remoteIdentityKey ?? '未绑定远端身份'}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>当前主路径</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. 打开本地档案</p>
          <p>2. 进入“网络 → 设备”启动 embedded RT</p>
          <p>3. 与另一台设备做 discovery / pairing / confirmed peer</p>
          <p>4. 由 RT signal + projector + backfill 完成多设备同步</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>验收入口</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>推荐从设备页与当下/任务页联调，而不是手动输入旧同步服务器地址。</p>
          <div className="flex gap-3">
            <Link
              to="/agents"
              search={{ view: 'device' }}
              className="inline-flex items-center rounded-md border px-3 py-2 hover:bg-accent"
            >
              打开设备页
            </Link>
            <Link
              to="/eventlog"
              className="inline-flex items-center rounded-md border px-3 py-2 hover:bg-accent"
            >
              打开当下页
            </Link>
            <Link
              to="/tasks"
              className="inline-flex items-center rounded-md border px-3 py-2 hover:bg-accent"
            >
              打开任务页
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
