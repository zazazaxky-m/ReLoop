import { preload } from "react-dom";

const BODY_FACES = ["/landing/fonts/dm-sans-400.ttf", "/landing/fonts/dm-sans-700.ttf"];

/**
 * Asks for the body face early on pages outside the landing (the landing loads
 * the same files from its own CSS). Anton is left to load on use: it only sets
 * metric values and numbers.
 */
export function preloadEditorialFonts() {
  for (const href of BODY_FACES) {
    preload(href, { as: "font", type: "font/ttf", crossOrigin: "anonymous" });
  }
}
