import { useEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { appRouter } from "@/routes";
import { ThemeController } from "@/components/ThemeController";
import { Toaster } from "@/components/ui/toaster";
import { UpdateToast } from "@/ui/components/UpdateToast";
import { TimeBlockSyncCoordinator } from "@/ui/app/components/TimeBlockSyncCoordinator";
import { TaskSyncCoordinator } from "@/ui/app/components/TaskSyncCoordinator";
import { ReminderSyncCoordinator } from "@/ui/app/components/ReminderSyncCoordinator";
import {
  initUpdateChecker,
  destroyUpdateChecker,
} from "@/ui/stores/update-store";
import { useSignalStream } from "@/ui/hooks/useSignalStream";
import {
  initVoiceShortcutService,
  getVoiceShortcutService,
} from "@/services/voice-shortcut.service";
import "./App.css";

function App() {
  useEffect(() => {
    initUpdateChecker();
    initVoiceShortcutService();
    return () => {
      destroyUpdateChecker();
      getVoiceShortcutService().destroy();
    };
  }, []);

  // 连接 RT SSE 信号流，接收 Agent 反馈
  useSignalStream();

  return (
    <>
      <ThemeController />
      <TimeBlockSyncCoordinator />
      <TaskSyncCoordinator />
      <ReminderSyncCoordinator />
      <RouterProvider router={appRouter} />
      <Toaster />
      <UpdateToast />
    </>
  );
}

export default App;
