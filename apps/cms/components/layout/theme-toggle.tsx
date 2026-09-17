"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === "dark";

  /**
   * Gated on `mounted` for the same reason the icon is.
   *
   * The server has no theme to resolve, so it renders "Switch to dark mode"
   * while a client already in dark mode renders "Switch to light mode". An
   * attribute that disagrees across hydration is a console error on every page
   * that shows this button, not merely a wrong label. The icon was guarded;
   * this was missed.
   */
  const label = !mounted
    ? "Switch theme"
    : isDark
      ? "Switch to light mode"
      : "Switch to dark mode";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className="rounded-full"
      onClick={() => {
        if (!mounted) {
          return;
        }

        setTheme(isDark ? "light" : "dark");
      }}
      aria-label={label}
    >
      {!mounted ? (
        <span className="size-4" />
      ) : isDark ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}
