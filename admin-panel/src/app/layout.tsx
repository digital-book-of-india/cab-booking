import type { Metadata } from 'next';
import { MswProvider } from '@/components/MswProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Car Booking Platform — Admin Operations',
  description: 'Mission Control for Ride Dispatch, Safety, and Fleet Operations',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-950">
        <MswProvider>{children}</MswProvider>
      </body>
    </html>
  );
}
