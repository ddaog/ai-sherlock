import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { GA_MEASUREMENT_ID } from "@/lib/analytics";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ai-sherlock.vercel.app";

export const metadata: Metadata = {
  title: "AI 셜록 v0.1 | 텍스트 추리 게임",
  description:
    "기록을 조회하고 질문하며 사건의 전말을 재구성하세요. AI 셜록과 함께 미스터리를 풀어보세요.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: SITE_URL,
    siteName: "AI 셜록",
    title: "AI 셜록 v0.1 | 텍스트 추리 게임",
    description:
      "기록을 조회하고 질문하며 사건의 전말을 재구성하세요. AI 셜록과 함께 미스터리를 풀어보세요.",
    images: [
      {
        url: "/og-image.png",
        width: 1024,
        height: 520,
        alt: "AI 셜록 - 텍스트 기반 추리 게임",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI 셜록 v0.1 | 텍스트 추리 게임",
    description:
      "기록을 조회하고 질문하며 사건의 전말을 재구성하세요. AI 셜록과 함께 미스터리를 풀어보세요.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-screen h-full bg-archive-bg text-archive-text font-serif antialiased">
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
            gtag('set', 'user_properties', { service_name: 'ai-sherlock' });
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}
