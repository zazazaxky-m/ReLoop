import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// twMerge makes a later className reliably override a component's base classes
// (e.g. rounded-full over rounded-lg); with clsx alone the winner depended on
// the order Tailwind happened to emit the rules in.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
