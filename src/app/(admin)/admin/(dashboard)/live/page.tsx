import Link from "next/link";
import { listLiveLots } from "@/server/auction/live-lots";
import { requireAdmin } from "@/server/identity/authz";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const sofia = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Sofia",
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Durations, not clock times, so no timezone is involved.
 *
 * Rendered on the server like every other date in this codebase — the
 * page is force-dynamic and an auctioneer refreshes it, which is the
 * right amount of live for a list nobody should be staring at.
 */
function duration(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  // Days once there are any: "in 95h 43m" is a genuinely bad way to tell
  // somebody a lot closes in four days.
  if (days > 0) return `${days}d ${hours}h`;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/*
 * Lots mid-auction — docs/open-items.md §3.4.
 *
 * Extension is uncapped by design, so the two questions this answers are
 * "what is still running?" and "has anything run away with itself?".
 */
export default async function LiveLotsPage() {
  await requireAdmin();
  const lots = await listLiveLots();

  const extending = lots.filter((lot) => lot.extending);
  const runningLong = lots.filter((lot) => lot.runningLong);
  const overdue = lots.filter((lot) => lot.overdue);

  return (
    <>
      <div className="admin-page-head">
        <h1>Live lots</h1>
      </div>

      {lots.length === 0 ? (
        <p className="admin-empty">
          Nothing is open for bidding. Lots appear here the moment the closing worker opens them.
        </p>
      ) : (
        <>
          <p className="hint">
            <strong>{lots.length}</strong> open · <strong>{extending.length}</strong> in extension
            {runningLong.length > 0 ? (
              <>
                {" "}
                · <strong data-tone="error">{runningLong.length} running long</strong>
              </>
            ) : null}
          </p>

          {overdue.length > 0 ? (
            /*
             * The one condition on this page that is not about the
             * auction at all. A lot past its close and still open means
             * nothing is closing it — almost always the worker being
             * down, which is otherwise invisible until somebody asks why
             * a lot never ended.
             */
            <p className="admin-notice" data-tone="error">
              <strong>
                {overdue.length} lot{overdue.length === 1 ? "" : "s"} past the close and still open.
              </strong>{" "}
              Check that the closing worker is running — nothing closes without it.
            </p>
          ) : null}

          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Lot</th>
                <th scope="col">Closes</th>
                <th scope="col">Extensions</th>
                <th scope="col">Past schedule</th>
                <th scope="col">Bids</th>
                <th scope="col">Top bid</th>
                <th scope="col">Reserve</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <tr key={lot.id} data-overdue={lot.runningLong || lot.overdue ? "true" : undefined}>
                  <td>
                    <Link href={`/admin/lots/${lot.id}`}>
                      {String(lot.lotNumber).padStart(3, "0")} — {lot.title}
                    </Link>
                    {lot.extending ? <> · <span className="admin-chip" data-status="EXTENDING">EXTENDING</span></> : null}
                  </td>
                  <td>
                    {lot.effectiveCloseAt ? sofia.format(lot.effectiveCloseAt) : "—"}
                    {lot.closesInMs !== null ? (
                      <>
                        <br />
                        <span className="hint">
                          {lot.closesInMs >= 0
                            ? `in ${duration(lot.closesInMs)}`
                            : `${duration(lot.closesInMs)} ago`}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>{lot.extensionCount === 0 ? "—" : `×${lot.extensionCount}`}</td>
                  <td>{lot.overrunMs === 0 ? "—" : duration(lot.overrunMs)}</td>
                  <td>{lot.bidCount}</td>
                  <td>
                    {lot.topBidMinor === null ? "no bids" : formatMoney(lot.topBidMinor, "en")}
                  </td>
                  <td>
                    {/*
                      Met or not, never the figure. §3 invariant 7 keeps
                      the reserve on the server, and a list like this is
                      read over somebody's shoulder.
                    */}
                    {lot.reserveMet ? "met" : "not met"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
