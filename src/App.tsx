import { RouterProvider } from "@tanstack/react-router";
import { router } from "@/routes";
import { ThemeController } from "@/components/ThemeController";
import "./App.css";

function App() {
  return (
    <>
      <ThemeController />
      <RouterProvider router={router} />
    </>
  );
}

export default App;
