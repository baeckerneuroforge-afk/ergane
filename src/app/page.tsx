import { redirect } from 'next/navigation';

// The only entry point. Middleware guarantees an authenticated user with an
// active org before this runs, so we just forward to the dashboard.
export default function Home() {
  redirect('/dashboard');
}
