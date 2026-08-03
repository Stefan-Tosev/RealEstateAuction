import Link from "next/link";
import { listProperties } from "@/server/catalogue/admin";
import { requireAdmin } from "@/server/identity/authz";

export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  await requireAdmin();
  const properties = await listProperties();

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Properties</h1>
          <p>The physical assets. A property can be auctioned more than once.</p>
        </div>
        <Link className="admin-btn admin-btn-primary" href="/admin/properties/new">
          New property
        </Link>
      </div>

      {properties.length === 0 ? (
        <div className="admin-empty">
          <p>No properties yet.</p>
        </div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Slug</th>
              <th>City</th>
              <th>Type</th>
              <th className="num">Images</th>
              <th className="num">Lots</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {properties.map((property) => (
              <tr key={property.id}>
                <td>{property.titleBg}</td>
                <td>
                  <code>{property.slug}</code>
                </td>
                <td>{property.city}</td>
                <td>{property.propertyType}</td>
                <td className="num">
                  {/* Zero images blocks publication, so it is worth flagging here. */}
                  {property._count.images === 0 ? (
                    <span className="admin-chip" data-status="CANCELLED">
                      none
                    </span>
                  ) : (
                    property._count.images
                  )}
                </td>
                <td className="num">{property._count.lots}</td>
                <td>
                  <Link className="admin-btn admin-btn-sm" href={`/admin/properties/${property.id}`}>
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
