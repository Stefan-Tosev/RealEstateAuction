import { notFound } from "next/navigation";
import { getSeller } from "@/server/sellers/admin";
import { requireAdmin } from "@/server/identity/authz";
import { SellerForm } from "../seller-form";

export const dynamic = "force-dynamic";

export default async function EditSellerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const seller = await getSeller(id);
  if (!seller) notFound();

  return (
    <>
      <div className="admin-page-head">
        <h1>{seller.name}</h1>
      </div>
      <SellerForm
        seller={{
          id: seller.id,
          kind: seller.kind,
          name: seller.name,
          email: seller.email ?? "",
          phone: seller.phone ?? "",
          eik: seller.eik ?? "",
          vat: seller.vat ?? "",
          address: seller.address ?? "",
          notes: seller.notes ?? "",
        }}
      />
    </>
  );
}
