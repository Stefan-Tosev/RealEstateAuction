import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locales";
import { interpolate } from "@/lib/i18n/plural";
import type { PublicSlot } from "@/server/viewings/bookings";
import { ViewingSlotActions } from "./viewing-slot-actions";

/*
 * Viewings on the lot page, for the same reason the legal pack is here:
 * booking one is a decision made while looking at the property.
 *
 * The list is a server component; only the book/cancel buttons are
 * client-side, so the slot data and its formatting never cross the
 * boundary as anything but strings.
 */
export function ViewingsSection({
  slots,
  locale,
  slug,
  isBidder,
}: {
  slots: PublicSlot[];
  locale: Locale;
  slug: string;
  isBidder: boolean;
}) {
  const t = getDictionary(locale);

  return (
    <section className="viewings" id="viewings">
      <h2 className="section-title">{t.viewings.heading}</h2>

      {slots.length === 0 ? (
        <p className="viewings-empty">{t.viewings.empty}</p>
      ) : (
        <>
          <p className="viewings-lede">{t.viewings.lede}</p>

          <ul className="slot-list">
            {slots.map((slot) => {
              const full = slot.placesLeft === 0 && !slot.bookedByViewer;

              return (
                <li className="slot" key={slot.id} data-full={full}>
                  <div className="slot-when">
                    <span className="slot-date">{slot.startsAtFormatted}</span>
                    <span className="slot-meta">
                      {slot.kind === "open_house" ? t.viewings.openHouse : t.viewings.privateViewing}
                      {" · "}
                      {interpolate(t.viewings.minutes, locale, slot.durationMinutes)}
                    </span>
                  </div>

                  <span className="slot-places">
                    {slot.bookedByViewer
                      ? t.viewings.booked
                      : full
                        ? t.viewings.full
                        : interpolate(t.viewings.placesLeft, locale, slot.placesLeft)}
                  </span>

                  {isBidder ? (
                    <ViewingSlotActions
                      locale={locale}
                      slug={slug}
                      viewingId={slot.id}
                      booked={slot.bookedByViewer}
                      full={full}
                      labels={{
                        book: t.viewings.book,
                        booking: t.viewings.booking,
                        cancel: t.viewings.cancel,
                        errorFull: t.viewings.errorFull,
                        errorPast: t.viewings.errorPast,
                        errorAlready: t.viewings.errorAlready,
                        errorGeneric: t.viewings.errorGeneric,
                      }}
                    />
                  ) : (
                    /*
                     * §5: "Booking requires a registered account." The
                     * slot and its remaining places are still shown —
                     * that is the reason to register.
                     */
                    <Link className="btn btn-outline btn-sm slot-action" href={`/${locale}/sign-in`}>
                      {t.viewings.signInToBook}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
