import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locales";
import { plural } from "@/lib/i18n/plural";
import type { PackDocument } from "@/server/documents/lot-documents";

/*
 * The legal pack, on the lot page rather than a page of its own.
 *
 * docs/architecture.md §5 calls this "what earns the 21-day preview" —
 * it is the thing that turns a browser into a serious buyer, so it
 * belongs where they are already looking.
 *
 * Every document is listed for everyone. What changes with the viewer is
 * how much is said about it: a gated row shows the kind and size and
 * what would be needed to open it, but not the filename and not a link.
 * Hiding the row entirely would defeat the gate's purpose, which is to
 * capture the lead.
 */

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function LegalPack({
  documents,
  locale,
}: {
  documents: PackDocument[];
  locale: Locale;
}) {
  const t = getDictionary(locale);

  return (
    <section className="legal-pack" id="legal-pack">
      <h2 className="section-title">{t.pack.heading}</h2>

      {documents.length === 0 ? (
        <p className="pack-empty">{t.pack.empty}</p>
      ) : (
        <>
          <p className="pack-lede">
            {plural(locale, { one: t.pack.countOne, other: t.pack.countOther }, documents.length)}
            {" · "}
            {t.pack.lede}
          </p>

          <ul className="pack-list">
            {documents.map((document) => (
              <li className="pack-item" key={document.id} data-locked={!document.downloadable}>
                <div className="pack-item-main">
                  <span className="pack-kind">{t.pack.kinds[document.kind]}</span>
                  {/* Filename only when it is theirs to see. */}
                  {document.filename ? (
                    <span className="pack-filename">{document.filename}</span>
                  ) : null}
                </div>

                <span className="pack-size">{formatSize(document.sizeBytes)}</span>

                {document.downloadable && document.href ? (
                  <a
                    className="btn btn-outline btn-sm pack-action"
                    href={document.href}
                    // The route sends Content-Disposition: attachment
                    // regardless; this is the hint, not the control.
                    download
                  >
                    {t.pack.download}
                  </a>
                ) : document.reason === "approval-required" ? (
                  <span className="pack-action pack-locked">{t.pack.approvalRequired}</span>
                ) : (
                  <Link className="btn btn-outline btn-sm pack-action" href={`/${locale}/register`}>
                    {t.pack.signInToDownload}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
