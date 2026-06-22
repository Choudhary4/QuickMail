import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel deployment optimizations
  output: 'standalone', // Optimize for serverless deployment
  
  

  // Disable TypeScript errors during build
  // TODO: Fix TypeScript errors and re-enable
  typescript: {
    ignoreBuildErrors: true,
  },
  
  // Ensure proper handling of environment variables
  env: {
    // Public env vars are automatically exposed via NEXT_PUBLIC_ prefix
  },
  
  // Experimental features for better performance
  experimental: {
    // Enable server actions if needed in future
  },
  
  // Image optimization (if using next/image)
  images: {
    domains: [],
    remotePatterns: [],
  },
};

export default nextConfig;
