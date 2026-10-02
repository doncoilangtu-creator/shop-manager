import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "quotations";
export const PDF_LINK_TTL_SECONDS = 60 * 60; // 1 hour; links are generated per request

/** Upload a rendered PDF to the PRIVATE bucket and return its object path (never a public URL). */
export async function uploadQuotationPdf(opts: { code: string; pdf: Uint8Array }): Promise<{ path: string }> {
  const admin = createAdminClient();
  await ensurePrivateBucket(admin);
  const path = `${opts.code}-${Date.now()}.pdf`;
  const { error } = await admin.storage.from(BUCKET).upload(path, opts.pdf, {
    contentType: "application/pdf",
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error("Upload PDF thất bại: " + error.message);
  return { path };
}

/** Short-lived signed link for an object path. */
export async function signQuotationPdf(path: string, ttl = PDF_LINK_TTL_SECONDS): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) throw new Error("Không tạo được liên kết PDF");
  return data.signedUrl;
}

async function ensurePrivateBucket(admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await admin.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["application/pdf"],
    });
    if (error && !/already exists/i.test(error.message)) throw new Error("Không tạo được bucket: " + error.message);
  } else if (data.public) {
    // a bucket created by an older version of this app was public: lock it down
    await admin.storage.updateBucket(BUCKET, { public: false });
  }
}
