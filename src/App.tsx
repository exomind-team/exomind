import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import { newUiRouter } from "@/routes-new";
import { ThemeController } from "@/components/ThemeController";
import { Toaster } from "@/components/ui/toaster";
import { bindTimeBlockNotificationBridge } from "@/lib/services/timeblock-notification.service";
import "./App.css";

function App() {
  useEffect(() => {
    return bindTimeBlockNotificationBridge();
  }, []);

  return (
    <>
      <ThemeController />
      <RouterProvider router={newUiRouter} />
      <Toaster />
    </>
  );
}

export default App;
