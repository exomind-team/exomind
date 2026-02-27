import { RouterProvider } from "@tanstack/react-router";
import { newUiRouter } from "@/routes-new";
import { ThemeController } from "@/components/ThemeController";
import { Toaster } from "@/components/ui/toaster";
import "./App.css";

function App() {
  return (
    <>
      <ThemeController />
      <RouterProvider router={newUiRouter} />
      <Toaster />
    </>
  );
}

export default App;
