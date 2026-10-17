import { Grid3x3 } from "lucide-react";
import type { AppPlugin } from "../types";

/** Pixel Studio: a pixel-art editor and animator, loaded when `#/pixel` opens. */
export const pixelPlugin = {
  kind: "pixel",
  route: "/pixel",
  titleKey: "nav.pixel",
  refKey: "desktop.ref.app.pixel",
  descKey: "microapp.pixel.desc",
  Icon: Grid3x3,
  load: () => import("./PixelStudio"),
} as const satisfies AppPlugin;
