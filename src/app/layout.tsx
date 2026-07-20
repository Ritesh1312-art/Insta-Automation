import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'InstaDM Auto — Self-Hosted Instagram Comment-to-DM Platform',
  description: 'Production-ready official Meta Graph API Instagram Comment-to-DM Automation platform.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 antialiased selection:bg-fuchsia-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
