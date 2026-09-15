import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'InstaDM — Tap a Reel. Send the DM.',
  description: 'Official Meta Graph API comment-to-DM studio. Connect Instagram, see your real posts, attach an auto-DM in one tap.',
  verification: {
    other: {
      'facebook-domain-verification': ['x7cerzpt4dqxmiygdsptlkwa540f84'],
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="facebook-domain-verification" content="x7cerzpt4dqxmiygdsptlkwa540f84" />
      </head>
      <body className="min-h-screen bg-[#07040a] font-sans text-zinc-100 antialiased selection:bg-fuchsia-500 selection:text-white" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
