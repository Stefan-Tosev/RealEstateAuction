import Link from "next/link";
import { listPropertyOptions } from "@/server/catalogue/admin";
import { requireAdmin } from "@/server/identity/authz";
import { LotForm } from "../lot-form";

export const dynamic = "force-dynamic";

export default async function NewLotPage() {
  await requireAdmin();
  const properties = await listPropertyOptions();

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>New lot</h1>
          <p>Created as a draft. Publishing needs an agreed reserve, photographs and dates.</p>
        </div>
      </div>

      {properties.length === 0 ? (
        <div className="admin-empty">
          <p>Create a property first — a lot is an auction of one.</p>
          <p style={{ marginTop: "0.75rem" }}>
            <Link className="admin-btn" href="/admin/properties/new">
              New property
            </Link>
          </p>
        </div>
      ) : (
        <LotForm lot={null} properties={properties} defaultLotNumber={11} />
      )}
    </div>
  );
}
