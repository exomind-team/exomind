import { useEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { appRouter } from "@/routes";
import { ThemeController } from "@/components/ThemeController";
import { Toaster } from "@/components/ui/toaster";
import { DevInstanceTitleSync } from "@/ui/app/components/DevInstanceTitleSync";
import { TimeBlockSyncCoordinator } from "@/ui/app/components/TimeBlockSyncCoordinator";
import { ReminderSyncCoordinator } from "@/ui/app/components/ReminderSyncCoordinator";
import { FocusBgmCoordinator } from "@/ui/app/components/FocusBgmCoordinator";
import { MigrationDialogController } from "@/ui/components/MigrationDialogController";
import {
  initUpdateChecker,
  destroyUpdateChecker,
} from "@/ui/stores/update-store";
import { useSignalStream } from "@/ui/hooks/useSignalStream";
import {
  initVoiceShortcutService,
  getVoiceShortcutService,
} from "@/services/voice-shortcut.service";
import {
  getMainWindowShortcutService,
  initMainWindowShortcutService,
} from "@/services/main-window-shortcut.service";
import { getNowWorkbenchOverlayService } from "@/services/now-workbench-overlay.service";
import "./App.css";

function App() {
  useEffect(() => {
    initUpdateChecker();
    initVoiceShortcutService();
    initMainWindowShortcutService();
    void getNowWorkbenchOverlayService().init();
    return () => {
      destroyUpdateChecker();
      getVoiceShortcutService().destroy();
      getMainWindowShortcutService().destroy();
      getNowWorkbenchOverlayService().destroy();
    };
  }, []);

  // 连接 RT SSE 信号流，接收 Agent 反馈
  useSignalStream();

  return (
    <>
      <DevInstanceTitleSync />
      <ThemeController />
      <TimeBlockSyncCoordinator />
      <ReminderSyncCoordinator />
      <FocusBgmCoordinator />
      <MigrationDialogController />
      <RouterProvider router={appRouter} />
      <Toaster />
    </>
  );
}

export default App;
