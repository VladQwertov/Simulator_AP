import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-sans-base",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Арена переговоров",
  description: "Тренажёр переговоров с виртуальным собеседником — формулировки и стратегия игрока реально влияют на исход.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${manrope.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
