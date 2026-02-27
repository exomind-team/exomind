import { useEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { newUiRouter } from "@/routes-new";
import { ThemeController } from "@/components/ThemeController";
import { Toaster } from "@/components/ui/toaster";
import { UpdateToast } from "@/ui/components/UpdateToast";
import {
  initUpdateChecker,
  destroyUpdateChecker,
} from "@/ui/stores/update-store";
import "./App.css";

function App() {
  useEffect(() => {
    initUpdateChecker();
    return () => destroyUpdateChecker();
  }, []);

  return (
    <>
      <ThemeController />
      <RouterProvider router={newUiRouter} />
      <Toaster />
      <UpdateToast />
    </>
  );
}

export default App;
