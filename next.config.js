/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // font tiếng Việt cho PDF sổ/tờ khai (đọc từ đĩa lúc chạy route)
  outputFileTracingIncludes: { "/api/**/*": ["./assets/fonts/**/*"] },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

module.exports = nextConfig;
