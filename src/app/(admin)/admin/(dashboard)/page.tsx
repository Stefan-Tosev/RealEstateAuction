import { auth } from "@/server/identity/auth";

export default async function AdminDashboardPage() {
  const session = await auth();

  return (
    <div>
      <h1>Welcome{session?.user?.name ? `, ${session.user.name}` : ""}</h1>
      <p>
        This is the Phase 0 admin shell. Lot and property management, bidder
        approval, documents, viewings and deposits are built in later phases
        — see docs/architecture.md §8.
      </p>
    </div>
  );
}
