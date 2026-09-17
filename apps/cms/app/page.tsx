import { redirect } from "next/navigation";

import { getCurrentCmsUser } from "@/lib/appwrite/auth";

export default async function Home() {
  const cmsUser = await getCurrentCmsUser();

  redirect(cmsUser ? "/dashboard" : "/login");
}
