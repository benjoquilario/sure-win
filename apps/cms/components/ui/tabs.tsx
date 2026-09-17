"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "relative inline-flex w-fit items-center gap-1 rounded-full border border-border/70 bg-muted/40 p-1",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative z-10 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none select-none",
        "hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
        "data-selected:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** The pill that slides behind the selected tab. */
function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        // Base UI publishes the active tab's box as CSS variables; using all
        // four makes the pill sit exactly on the tab instead of approximately.
        "absolute left-0 top-0 z-0 h-[var(--active-tab-height)] w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] translate-y-[var(--active-tab-top)] rounded-full bg-card shadow-sm transition-all duration-200 ease-out",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger };
