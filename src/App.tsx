import { RouterProvider } from "@tanstack/react-router";
import { appRouter } from "@/routes";
import { ThemeController } from "@/components/ThemeController";
import { Toaster } from "@/components/ui/toaster";
import "./App.css";

function App() {
  return (
    <>
      <ThemeController />
      <RouterProvider router={appRouter} />
      <Toaster />
    </>
  );
}

export default App;
