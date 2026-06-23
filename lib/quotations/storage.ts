import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "quotations";

/**
 * Upload a PDF Buffer to the `quotations` bucket and return a public URL.
 * Path: quotations/{code}-{timestamp}.pdf
 *
 * Bucket is created on first call (idempotent).
 */
export async function uploadQuotationPdf(opts: {
  code: string;
  pdf: Uint8Array;
}): Promise<{ url: string; path: string }> {
  const admin = createAdminClient();

  // Ensure bucket exists (private — we return signed/public URL based on bucket config).
  await ensureBucket(admin);

  const fileName = `${opts.code}-${Date.now()}.pdf`;
  const path = `${fileName}`;

  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, opts.pdf, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: true,
    });

  if (error) {
    throw new Error("Upload PDF thất bại: " + error.message);
  }

  // Try public URL first; if bucket is private, fall back to a 7-day signed URL.
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  if (pub?.publicUrl) {
    return { url: pub.publicUrl, path };
  }
  const { data: signed, error: sErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (sErr || !signed?.signedUrl) {
    throw new Error("Không tạo được URL PDF");
  }
  return { url: signed.signedUrl, path };
}

async function ensureBucket(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin.storage.getBucket(BUCKET);
  if (error || !data) {
    const { error: cErr } = await admin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024, // 10 MB
      allowedMimeTypes: ["application/pdf"],
    });
    if (cErr && !/already exists/i.test(cErr.message)) {
      console.warn("Could not create bucket:", cErr.message);
    }
  }
}
