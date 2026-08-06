import Link from "next/link";
import { notFound } from "next/navigation";
import { getProperty } from "@/server/catalogue/admin";
import { requireAdmin } from "@/server/identity/authz";
import { mediaStorage } from "@/server/storage";
import { PropertyForm, type PropertyFormValues } from "../property-form";
import { ImageManager } from "./image-manager";
import { copyDraftingConfigured } from "@/server/copy/draft";

export const dynamic = "force-dynamic";

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const property = await getProperty(id);
  if (!property) notFound();

  /*
   * Flattened to plain strings before crossing into the client form —
   * Decimal (areaSqm, lat, lng) cannot be serialized across that
   * boundary, the same rule the public mappers enforce.
   */
  const values: PropertyFormValues = {
    id: property.id,
    slug: property.slug,
    titleBg: property.titleBg,
    titleEn: property.titleEn,
    descriptionBg: property.descriptionBg,
    descriptionEn: property.descriptionEn,
    address: property.address,
    city: property.city,
    region: property.region,
    propertyType: property.propertyType,
    rooms: property.rooms?.toString() ?? "",
    areaSqm: property.areaSqm?.toString() ?? "",
    floor: property.floor?.toString() ?? "",
    yearBuilt: property.yearBuilt?.toString() ?? "",
    cadastralId: property.cadastralId ?? "",
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>{property.titleBg}</h1>
          <p>
            <code>{property.slug}</code> ·{" "}
            <Link href={`/bg/lots/${property.slug}`} target="_blank">
              view public page ↗
            </Link>
          </p>
        </div>
        <Link className="admin-btn" href="/admin/properties">
          Back to properties
        </Link>
      </div>

      <ImageManager
        propertyId={property.id}
        images={property.images.map((image) => ({
          id: image.id,
          altBg: image.altBg,
          altEn: image.altEn,
          width: image.width,
          height: image.height,
          url: mediaStorage.publicUrl(image.storageKey),
        }))}
      />

      <hr style={{ border: 0, borderTop: "1px solid var(--admin-border)", margin: "2rem 0" }} />

      <PropertyForm property={values} copyDraftingAvailable={copyDraftingConfigured()} />
    </div>
  );
}
