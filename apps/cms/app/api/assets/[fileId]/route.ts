import { NextResponse } from "next/server";
import { AppwriteException } from "node-appwrite";

import { authorizeRequest } from "@/lib/appwrite/auth";
import { appwriteEnv, hasAppwriteServerEnv } from "@/lib/appwrite/env";
import { getAdminServices } from "@/lib/appwrite/server";

type AssetRouteContext = {
  params: Promise<{ fileId: string }>;
};

export const runtime = "nodejs";

function normalizeFileId(rawValue: string) {
  try {
    return decodeURIComponent(rawValue).trim();
  } catch {
    return rawValue.trim();
  }
}

function toResponseBody(value: unknown): string | ArrayBuffer {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    const copied = new Uint8Array(value.byteLength);
    copied.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return copied.buffer;
  }

  throw new Error("Unsupported storage payload type.");
}

export async function GET(_request: Request, context: AssetRouteContext) {
  if (!hasAppwriteServerEnv()) {
    return NextResponse.json(
      { error: "Appwrite server configuration is incomplete." },
      { status: 503 },
    );
  }

  const { fileId } = await context.params;
  const normalizedFileId = normalizeFileId(fileId);

  if (!normalizedFileId) {
    return NextResponse.json({ error: "Missing file id." }, { status: 400 });
  }

  const { storage } = getAdminServices();

  try {
    const [file, fileData] = await Promise.all([
      storage.getFile({
        bucketId: appwriteEnv.assetsBucketId,
        fileId: normalizedFileId,
      }),
      storage.getFileDownload({
        bucketId: appwriteEnv.assetsBucketId,
        fileId: normalizedFileId,
      }),
    ]);

    return new NextResponse(toResponseBody(fileData), {
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.name || normalizedFileId)}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) {
      return NextResponse.json(
        { error: "Asset not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { error: "Failed to read stored image." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: AssetRouteContext) {
  if (!hasAppwriteServerEnv()) {
    return NextResponse.json(
      { error: "Appwrite server configuration is incomplete." },
      { status: 503 },
    );
  }

  const { error: authError } = await authorizeRequest("media.delete");

  if (authError) {
    return NextResponse.json(
      { error: authError.message },
      { status: authError.status },
    );
  }

  const { fileId } = await context.params;
  const normalizedFileId = normalizeFileId(fileId);

  if (!normalizedFileId) {
    return NextResponse.json({ error: "Missing file id." }, { status: 400 });
  }

  const { storage } = getAdminServices();

  try {
    await storage.deleteFile({
      bucketId: appwriteEnv.assetsBucketId,
      fileId: normalizedFileId,
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) {
      return NextResponse.json({ deleted: true });
    }

    return NextResponse.json(
      { error: "Failed to delete stored image." },
      { status: 500 },
    );
  }
}
