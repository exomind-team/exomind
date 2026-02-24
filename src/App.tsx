import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { router } from "@/routes";
import { newUiRouter } from "@/routes-new";
import { ThemeController } from "@/components/ThemeController";
import { Toaster } from "@/components/ui/toaster";
import { getUIMode, subscribeUIModeChanges, type UIMode } from "@/config/ui-mode";
import "./App.css";

function App() {
  const [uiMode, setUiMode] = useState<UIMode>(() => getUIMode());

  useEffect(() => {
    return subscribeUIModeChanges((mode) => {
      setUiMode(mode);
    });
  }, []);

  const activeRouter = uiMode === 'new' ? newUiRouter : router;

  return (
    <>
      <ThemeController />
      <RouterProvider key={uiMode} router={activeRouter} />
      <Toaster />
    </>
  );
}

export default App;
