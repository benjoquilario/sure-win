import { NextResponse } from "next/server";
import { AppwriteException, Compression, ID } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

import { authorizeRequest } from "@/lib/appwrite/auth";
import {
  appwriteEnv,
  getBaseUrl,
  hasAppwriteServerEnv,
} from "@/lib/appwrite/env";
import { getAdminServices } from "@/lib/appwrite/server";

const MAX_UPLOAD_SIZE_BYTES = 8 * 1024 * 1024;

export const runtime = "nodejs";

function getUploadErrorMessage(error: unknown) {
  if (error instanceof AppwriteException) {
    if (error.code === 404) {
      return "Storage bucket is missing. Please run the Appwrite bootstrap script.";
    }

    if (error.code === 413) {
      return "Image is too large for storage bucket limits.";
    }

    return error.message || "Failed to upload image.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to upload image.";
}

function resolveRequestOrigin(request: Request) {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();

  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!hasAppwriteServerEnv()) {
    return NextResponse.json(
      { error: "Appwrite server configuration is incomplete." },
      { status: 503 },
    );
  }

  const { error: authError } = await authorizeRequest("media.upload");

  if (authError) {
    return NextResponse.json(
      { error: authError.message },
      { status: authError.status },
    );
  }

  const formData = await request.formData();
  const fileValue = formData.get("file");

  if (!(fileValue instanceof File)) {
    return NextResponse.json(
      { error: "Please select an image file." },
      { status: 400 },
    );
  }

  if (!fileValue.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only image files are allowed." },
      { status: 400 },
    );
  }

  if (fileValue.size === 0) {
    return NextResponse.json(
      { error: "Selected file is empty." },
      { status: 400 },
    );
  }

  if (fileValue.size > MAX_UPLOAD_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Image is too large. Maximum size is 8 MB." },
      { status: 400 },
    );
  }

  const { storage } = getAdminServices();

  try {
    try {
      await storage.getBucket({ bucketId: appwriteEnv.assetsBucketId });
    } catch (error) {
      if (error instanceof AppwriteException && error.code === 404) {
        await storage.createBucket({
          bucketId: appwriteEnv.assetsBucketId,
          name: "Reviewer Assets",
          fileSecurity: false,
          enabled: true,
          maximumFileSize: 20 * 1024 * 1024,
          allowedFileExtensions: [
            "jpg",
            "jpeg",
            "png",
            "gif",
            "webp",
            "bmp",
            "svg",
            "avif",
          ],
          compression: Compression.None,
          encryption: false,
          antivirus: true,
          transformations: true,
        });
      } else {
        throw error;
      }
    }

    const uploadBuffer = Buffer.from(await fileValue.arrayBuffer());
    const uploadName = fileValue.name?.trim() || "uploaded-image";
    const uploadedFile = await storage.createFile({
      bucketId: appwriteEnv.assetsBucketId,
      fileId: ID.unique(),
      file: InputFile.fromBuffer(uploadBuffer, uploadName),
    });

    const assetPath = `/api/assets/${uploadedFile.$id}`;
    const requestOrigin = resolveRequestOrigin(request);
    const baseUrl = getBaseUrl(requestOrigin);
    const fullAssetUrl = new URL(assetPath, `${baseUrl}/`).toString();

    return NextResponse.json({
      fileId: uploadedFile.$id,
      name: uploadedFile.name,
      mimeType: uploadedFile.mimeType,
      url: fullAssetUrl,
      path: assetPath,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getUploadErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
