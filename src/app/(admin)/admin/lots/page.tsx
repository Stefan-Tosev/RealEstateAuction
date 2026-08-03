import Link from "next/link";
import { listLots } from "@/server/catalogue/admin";
import { requireAdmin } from "@/server/identity/authz";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function LotsPage() {
  await requireAdmin();
  const lots = await listLots();

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Lots</h1>
          <p>An auction of a property. Guide price is public; reserve is not.</p>
        </div>
        <Link className="admin-btn admin-btn-primary" href="/admin/lots/new">
          New lot
        </Link>
      </div>

      {lots.length === 0 ? (
        <div className="admin-empty">
          <p>No lots yet.</p>
        </div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th className="num">Lot</th>
              <th>Property</th>
              <th>Status</th>
              <th className="num">Guide</th>
              <th className="num">Reserve</th>
              <th>Ready?</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => {
              const notReady = [
                !lot.reserveAgreedBy ? "reserve" : null,
                lot.property._count.images === 0 ? "photos" : null,
                !lot.biddingOpensAt ? "dates" : null,
              ].filter(Boolean);

              return (
                <tr key={lot.id}>
                  <td className="num">{String(lot.lotNumber).padStart(3, "0")}</td>
                  <td>{lot.property.titleBg}</td>
                  <td>
                    <span className="admin-chip" data-status={lot.status}>
                      {lot.status}
                    </span>
                  </td>
                  <td className="num">{formatMoney(lot.startingPriceMinor, "en")}</td>
                  <td className="num">
                    {/*
                      Visible here and nowhere public. This page is behind
                      auth and the value never enters a public DTO.
                    */}
                    {formatMoney(lot.reservePriceMinor, "en")}
                  </td>
                  <td>
                    {lot.status !== "DRAFT" ? (
                      <span className="admin-chip">live</span>
                    ) : notReady.length === 0 ? (
                      <span className="admin-chip" data-status="PUBLISHED">
                        ready
                      </span>
                    ) : (
                      <span className="admin-chip" data-status="CANCELLED">
                        needs {notReady.join(", ")}
                      </span>
                    )}
                  </td>
                  <td>
                    <Link className="admin-btn admin-btn-sm" href={`/admin/lots/${lot.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
