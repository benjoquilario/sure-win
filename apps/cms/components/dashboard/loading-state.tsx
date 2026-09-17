import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function StatCardSkeleton() {
  return (
    <Card className="border-border/80 bg-card/80">
      <CardContent className="p-6">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-10 w-24" />
        <Skeleton className="mt-3 h-4 w-44" />
      </CardContent>
    </Card>
  );
}

export function DashboardCardsSkeleton() {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <StatCardSkeleton />
      <StatCardSkeleton />
      <StatCardSkeleton />
      <StatCardSkeleton />
    </section>
  );
}

export function DashboardSchemaStatusSectionSkeleton() {
  return (
    <Card className="border-border/80 bg-card/80">
      <CardHeader>
        <Badge className="w-fit uppercase tracking-[0.3em] text-[10px]">
          Loading
        </Badge>
        <Skeleton className="mt-3 h-8 w-64" />
      </CardHeader>
      <CardContent>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Card className="border-border/70 bg-muted/35">
            <CardContent className="p-5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="mt-2 h-8 w-16" />
            </CardContent>
          </Card>
          <Card className="border-border/70 bg-muted/35">
            <CardContent className="p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-8 w-12" />
            </CardContent>
          </Card>
        </div>

        <Card className="mt-5 border-border/70 bg-muted/35">
          <CardContent className="p-5">
            <Skeleton className="h-4 w-44" />
            <div className="mt-3 grid gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
}

export function DashboardManageTablesSectionSkeleton() {
  return (
    <Card className="border-border/80 bg-card/80">
      <CardHeader>
        <Badge className="w-fit uppercase tracking-[0.3em] text-[10px]">
          Loading
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="border-border/70 bg-muted/35">
              <CardContent className="p-5">
                <Skeleton className="h-3 w-36" />
                <Skeleton className="mt-3 h-9 w-12" />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Skeleton className="h-8 w-28 rounded-full" />
                  <Skeleton className="h-8 w-20 rounded-full" />
                  <Skeleton className="h-8 w-24 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardRecordFormSkeleton() {
  return (
    <Card className="border-border/80 bg-card/80">
      <CardHeader>
        <Badge className="w-fit uppercase tracking-[0.3em] text-[10px]">
          Loading Form
        </Badge>
        <Skeleton className="mt-3 h-7 w-56" />
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="md:col-span-2 grid gap-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-28 w-full" />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Skeleton className="h-10 w-28 rounded-full" />
          <Skeleton className="h-10 w-36 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardRowTableSkeleton() {
  return (
    <Card className="overflow-hidden border-border/80 bg-card/80">
      <CardHeader className="border-b border-border/70">
        <CardTitle className="text-lg">Loading rows...</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid gap-3 px-6 py-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardRouteLoading() {
  return (
    <main className="space-y-6">
      <Card className="border-border/80 bg-card/80 backdrop-blur">
        <CardHeader>
          <Badge className="w-fit uppercase tracking-[0.3em] text-[10px]">
            Loading Dashboard
          </Badge>
          <Skeleton className="mt-4 h-11 w-3/4 max-w-xl" />
          <div className="mt-3 grid gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
          </div>
        </CardHeader>
      </Card>

      <DashboardCardsSkeleton />

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <DashboardSchemaStatusSectionSkeleton />
        <Card className="border-border/80 bg-card/80">
          <CardHeader>
            <Badge className="w-fit uppercase tracking-[0.3em] text-[10px]">
              Loading
            </Badge>
            <Skeleton className="mt-3 h-8 w-64" />
            <div className="mt-3 grid gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-56 w-full" />
          </CardContent>
        </Card>
      </section>

      <DashboardManageTablesSectionSkeleton />
    </main>
  );
}

export function DashboardTableRouteLoading() {
  return (
    <main className="space-y-6">
      <Card className="border-border/80 bg-card/80">
        <CardHeader>
          <Badge className="w-fit uppercase tracking-[0.3em] text-[10px]">
            Loading Table
          </Badge>
          <Skeleton className="mt-2 h-10 w-72" />
          <div className="mt-3 grid gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </CardHeader>
      </Card>

      <DashboardRecordFormSkeleton />
      <DashboardRowTableSkeleton />
    </main>
  );
}

export function DashboardRecordRouteLoading() {
  return (
    <main className="space-y-6">
      <Card className="border-border/80 bg-card/80">
        <CardHeader>
          <Badge className="w-fit uppercase tracking-[0.3em] text-[10px]">
            Loading Record
          </Badge>
          <Skeleton className="mt-2 h-10 w-72" />
          <Skeleton className="mt-3 h-4 w-64" />
        </CardHeader>
      </Card>

      <DashboardRecordFormSkeleton />
    </main>
  );
}
