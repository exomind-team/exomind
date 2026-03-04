import { useEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { appRouter } from "@/routes";
import { ThemeController } from "@/components/ThemeController";
import { Toaster } from "@/components/ui/toaster";
import { UpdateToast } from "@/ui/components/UpdateToast";
import { TimeBlockSyncCoordinator } from "@/ui/app/components/TimeBlockSyncCoordinator";
import {
  initUpdateChecker,
  destroyUpdateChecker,
} from "@/ui/stores/update-store";
import { useSignalStream } from "@/ui/hooks/useSignalStream";
import "./App.css";

function App() {
  useEffect(() => {
    initUpdateChecker();
    return () => destroyUpdateChecker();
  }, []);

  // 连接 RT SSE 信号流，接收 Agent 反馈
  useSignalStream();

  return (
    <>
      <ThemeController />
      <TimeBlockSyncCoordinator />
      <RouterProvider router={appRouter} />
      <Toaster />
      <UpdateToast />
    </>
  );
}

export default App;
