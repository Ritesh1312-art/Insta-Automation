import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'InstaDM Auto — Official Instagram Comment-to-DM',
  description: 'Follow-gate comment-to-DM for professional Instagram accounts using Meta Graph API. Direct UPI plans with manual verification.',
  verification: {
    other: {
      'facebook-domain-verification': ['x7cerzpt4dqxmiygdsptlkwa540f84'],
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="facebook-domain-verification" content="x7cerzpt4dqxmiygdsptlkwa540f84" />
      </head>
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-fuchsia-500 selection:text-white" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
