import {
  Account,
  Client,
  Messaging,
  Storage,
  TablesDB,
  Users,
} from "node-appwrite";

import {
  appwriteEnv,
  hasAppwritePublicEnv,
  hasAppwriteServerEnv,
} from "@/lib/appwrite/env";

function createBaseClient() {
  if (!hasAppwritePublicEnv()) {
    throw new Error("Appwrite public environment variables are incomplete.");
  }

  return new Client()
    .setEndpoint(appwriteEnv.endpoint)
    .setProject(appwriteEnv.projectId);
}

export function createPublicServerClient() {
  return createBaseClient();
}

export function createSessionServerClient(sessionSecret: string) {
  return createBaseClient().setSession(sessionSecret);
}

export function createAdminClient() {
  if (!hasAppwriteServerEnv()) {
    throw new Error("Appwrite server environment variables are incomplete.");
  }

  return createBaseClient().setKey(appwriteEnv.apiKey);
}

export function getSessionServices(sessionSecret: string) {
  const client = createSessionServerClient(sessionSecret);

  return {
    client,
    account: new Account(client),
  };
}

export function getAdminServices() {
  const client = createAdminClient();

  return {
    client,
    account: new Account(client),
    tables: new TablesDB(client),
    storage: new Storage(client),
    users: new Users(client),
    messaging: new Messaging(client),
  };
}
