import { requireAdmin } from "@/server/identity/authz";
import { PropertyForm } from "../property-form";
import { copyDraftingConfigured } from "@/server/copy/draft";
import { sellerOptions } from "@/server/sellers/admin";

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

      <PropertyForm property={null} copyDraftingAvailable={copyDraftingConfigured()}
        sellers={await sellerOptions()}
      />
    </div>
  );
}
