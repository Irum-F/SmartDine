import GuestApp from './GuestApp.js';

export const metadata = {
  title: 'Order at your table · SmartDine',
  robots: { index: false, follow: false },
};

export default async function Page({ params }) {
  const { qrToken } = await params;
  return <GuestApp qrToken={qrToken} />;
}