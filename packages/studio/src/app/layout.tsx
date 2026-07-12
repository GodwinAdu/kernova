import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';

export const metadata: Metadata = {
  title: 'Kernova Studio',
  description: 'Developer dashboard for the Kernova AI agent platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 ml-56 p-6 overflow-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
