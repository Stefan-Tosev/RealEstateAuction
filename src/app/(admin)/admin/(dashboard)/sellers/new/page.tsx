import { requireAdmin } from "@/server/identity/authz";
import { SellerForm } from "../seller-form";

export const dynamic = "force-dynamic";

export default async function NewSellerPage() {
  await requireAdmin();

  return (
    <>
      <div className="admin-page-head">
        <h1>Add a seller</h1>
      </div>
      <SellerForm seller={null} />
    </>
  );
}
