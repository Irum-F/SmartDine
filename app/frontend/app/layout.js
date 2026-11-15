import './globals.css';

export const metadata = {
  title: 'SmartDine',
  description: 'Order from your table',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#14110d',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}