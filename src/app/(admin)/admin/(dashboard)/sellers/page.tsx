import Link from "next/link";
import { listSellers } from "@/server/sellers/admin";
import { requireAdmin } from "@/server/identity/authz";

export const dynamic = "force-dynamic";

export default async function SellersPage() {
  await requireAdmin();
  const sellers = await listSellers();

  return (
    <>
      <div className="admin-page-head">
        <h1>Sellers</h1>
        <Link className="admin-btn admin-btn-primary" href="/admin/sellers/new">
          Add a seller
        </Link>
      </div>

      <p className="hint">
        {/* Said plainly, because an operator entering someone's telephone
            number should know where it can and cannot end up. */}
        Contact details for running a transaction. Never shown in the public catalogue.
      </p>

      {sellers.length === 0 ? (
        <p className="admin-empty">
          No sellers yet. A lot cannot be published until its property has one.
        </p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Email</th>
              <th scope="col">Telephone</th>
              <th scope="col">Properties</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((seller) => (
              <tr key={seller.id}>
                <td>
                  <Link href={`/admin/sellers/${seller.id}`}>{seller.name}</Link>
                </td>
                <td>{seller.kind === "company" ? "Company" : "Private person"}</td>
                <td>{seller.email ?? "—"}</td>
                <td>{seller.phone ?? "—"}</td>
                <td className="num">{seller._count.properties}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
