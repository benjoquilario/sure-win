import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginWithEmailPassword } from "@/lib/actions/auth";
import { getCurrentCmsUser } from "@/lib/appwrite/auth";
import { appwriteEnv } from "@/lib/appwrite/env";
import { reviewerTableEntries } from "@workspace/schema";

const errorLabels: Record<string, string> = {
  unauthorized:
    "This dashboard is for the team. Your account can use the app, but it has not been given a staff role - ask a Super Admin if it should have one.",
  config:
    "Appwrite environment variables are incomplete. Fill in the server configuration before signing in.",
  oauth_redirect_invalid:
    "Appwrite rejected the OAuth redirect URL. Add your current app origin and callback URL to the Appwrite platform and OAuth provider configuration.",
  oauth_failed:
    "OAuth sign-in could not be started. Recheck the Appwrite provider configuration and allowed redirect URLs.",
  session_secret_missing:
    "Appwrite did not return a session secret for the dashboard session.",
  notification_queued: "Notification queued.",
};

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const cmsUser = await getCurrentCmsUser();

  if (cmsUser) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = await searchParams;
  const errorKey = String(resolvedSearchParams.error ?? "");
  const errorMessage = errorLabels[errorKey] ?? errorKey;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-border/80 bg-card/75 backdrop-blur sm:p-2">
          <CardHeader className="p-8 sm:p-10">
            <Badge className="w-fit uppercase tracking-[0.34em] text-[10px]">
              Admin Access
            </Badge>
            <CardTitle className="mt-2 max-w-3xl text-4xl tracking-tight sm:text-5xl">
              Manage reviewer subjects, questionnaires, questions, review
              content, and notifications from one Appwrite-backed dashboard.
            </CardTitle>
            <CardDescription className="mt-3 max-w-2xl text-base leading-8 sm:text-lg">
              This CMS manages subjects, topics, learning materials, exam
              categories, quiz and board exam papers with their questions,
              progress data, and the messaging layer used by your mobile
              application.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-8 pb-8 sm:px-10 sm:pb-10">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border-border/70 bg-muted/35">
                <CardContent className="p-5">
                  <p className="text-3xl font-semibold">
                    {reviewerTableEntries.length}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    schema tables across auth, review content, questionnaires,
                    progress, community, and moderation
                  </p>
                </CardContent>
              </Card>
              <Card className="border-border/70 bg-muted/35">
                <CardContent className="p-5">
                  <p className="text-3xl font-semibold">3</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    messaging channels: email, SMS, and push notification
                  </p>
                </CardContent>
              </Card>
              <Card className="border-border/70 bg-muted/35">
                <CardContent className="p-5">
                  <p className="text-3xl font-semibold">5</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    free daily questions can be enforced in mobile logic using
                    progress tables
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card className="mt-10 border-primary/20 bg-primary/8">
              <CardContent className="p-6">
                <p className="text-sm font-semibold text-primary">Project</p>
                <p className="mt-2 text-sm text-foreground/80">
                  {appwriteEnv.projectName}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {appwriteEnv.projectId || "Missing Appwrite project ID"}
                </p>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/75 backdrop-blur sm:p-2">
          <CardHeader className="p-8 pb-6 sm:p-10 sm:pb-6">
            <Badge className="w-fit uppercase tracking-[0.3em] text-[10px]">
              Sign In
            </Badge>
            <CardTitle className="text-2xl">Dashboard login</CardTitle>
            <CardDescription>
              For the team. Students sign in through the app, not here.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-8 pb-8 sm:px-10 sm:pb-10">
            {errorKey ? (
              <Alert variant="destructive" className="mt-1">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}

            <form action={loginWithEmailPassword} className="mt-8 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  name="email"
                  required
                  placeholder="admin@school.edu"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  name="password"
                  required
                  placeholder="Enter your password"
                />
              </div>

              <Button type="submit" size="lg" className="w-full rounded-full">
                Continue with email and password
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.25em] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              OAuth
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                variant="outline"
                size="lg"
                className="rounded-full"
                nativeButton={false}
                render={<Link href="/api/auth/oauth?provider=google" />}
              >
                Continue with Google
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="rounded-full"
                nativeButton={false}
                render={<Link href="/api/auth/oauth?provider=microsoft" />}
              >
                Continue with Microsoft
              </Button>
            </div>

            <Card className="mt-8 border-border/70 bg-muted/35">
              <CardContent className="p-5 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Who can sign in</p>
                <p className="mt-2">
                  Encoders, Moderators, Admins, and Super Admins. Everyone else
                  is a member and uses the mobile app - a role here changes
                  nothing about what they see in it.
                </p>
                <p className="mt-2">
                  A Super Admin grants access from Staff Access in the
                  dashboard. If nobody has it yet, the
                  APPWRITE_CMS_SUPER_ADMIN_EMAILS environment variable is the
                  way back in.
                </p>
              </CardContent>
            </Card>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
