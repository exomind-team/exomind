import { createFileRoute } from "@tanstack/react-router";

export const IndexRoute = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="p-2">
      <h3 className="text-lg font-medium">欢迎使用 ExoMind</h3>
      <p className="text-muted-foreground">选择左侧设备开始聊天</p>
    </div>
  );
}
