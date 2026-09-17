import { CmsShell } from "@/components/dashboard/cms-shell";
import { requireCmsUser } from "@/lib/appwrite/auth";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cmsUser = await requireCmsUser();

  return <CmsShell cmsUser={cmsUser}>{children}</CmsShell>;
}
