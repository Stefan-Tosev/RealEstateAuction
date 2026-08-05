import { listBidders } from "@/server/identity/bidder-approvals";
import { canPerform, requireAdmin } from "@/server/identity/authz";
import { BidderTable } from "./bidder-table";

export const dynamic = "force-dynamic";

export default async function BiddersPage() {
  const actor = await requireAdmin();
  const bidders = await listBidders();

  const sofia = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Sofia",
    dateStyle: "medium",
  });

  const pending = bidders.filter((b) => b.status !== "approved" && b.verified).length;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Bidders</h1>
          <p>
            Manual review, which is correct at this volume. Approval is what lets someone bid and
            what opens approved-bidders documents.
          </p>
        </div>
        {pending > 0 ? (
          <span className="admin-chip" data-status="PUBLISHED">
            {pending} awaiting a decision
          </span>
        ) : null}
      </div>

      <BidderTable
        canDecide={canPerform(actor.role, "bidder.decide")}
        bidders={bidders.map((bidder) => ({
          ...bidder,
          registeredAt: sofia.format(bidder.registeredAt),
          reviewedAt: bidder.reviewedAt ? sofia.format(bidder.reviewedAt) : null,
        }))}
      />
    </div>
  );
}
