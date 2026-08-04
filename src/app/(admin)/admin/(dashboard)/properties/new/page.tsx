import { requireAdmin } from "@/server/identity/authz";
import { PropertyForm } from "../property-form";

export const dynamic = "force-dynamic";

export default async function NewPropertyPage() {
  await requireAdmin();

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>New property</h1>
          <p>Photographs are added after the property exists.</p>
        </div>
      </div>

      <PropertyForm property={null} />
    </div>
  );
}
