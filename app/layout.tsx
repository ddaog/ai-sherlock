import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "단서 아카이브: 7월 18일 사건",
  description: "텍스트 롤플레이 기반 추리게임",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-archive-bg text-archive-text">
        {children}
      </body>
    </html>
  );
}
