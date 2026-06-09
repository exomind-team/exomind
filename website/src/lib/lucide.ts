import { Dot } from "lucide-static";

interface RenderLucideIconOptions {
  className?: string;
  size?: number | string;
  strokeWidth?: number | string;
}

export function renderLucideIcon(
  icon: string,
  { className = "", size = 24, strokeWidth = 2 }: RenderLucideIconOptions = {},
) {
  const svgClass = className.trim();

  return icon.trim().replace(
    /<svg\b[^>]*>/,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${svgClass ? ` class="${svgClass}"` : ""} aria-hidden="true">`,
  );
}

export const downloadMetaSeparatorIconHtml = renderLucideIcon(Dot, {
  className: "inline-block h-3.5 w-3.5 text-stone-300 dark:text-stone-600",
  size: 14,
});
