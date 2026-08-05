"use client";

import { useActionState } from "react";
import type { ViewingKind } from "@prisma/client";
import { createSlotAction, deleteSlotAction } from "../../../lot-extras-actions";
import type { FormState } from "../../../catalogue-actions";
import { Field } from "../../../_components/field";

export type AdminSlot = {
  id: string;
  startsAtFormatted: string;
  durationMinutes: number;
  capacity: number;
  booked: number;
  kind: ViewingKind;
  isPast: boolean;
};

export function SlotManager({ lotId, slots }: { lotId: string; slots: AdminSlot[] }) {
  const create = createSlotAction.bind(null, lotId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(create, undefined);
  const errors = state?.errors ?? {};

  const remove = deleteSlotAction.bind(null, lotId);

  return (
    <section>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Viewings</h2>

      {slots.length === 0 ? (
        <div className="admin-empty" style={{ marginBottom: "1.5rem" }}>
          <p>No viewing slots yet.</p>
        </div>
      ) : (
        <table className="admin-table" style={{ marginBottom: "1.5rem" }}>
          <thead>
            <tr>
              <th>Starts</th>
              <th>Kind</th>
              <th className="num">Length</th>
              <th className="num">Booked</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot.id}>
                <td>
                  {slot.startsAtFormatted}
                  {slot.isPast ? (
                    <span className="admin-chip" style={{ marginLeft: "0.5rem" }}>
                      past
                    </span>
                  ) : null}
                </td>
                <td>{slot.kind === "open_house" ? "Open house" : "Private"}</td>
                <td className="num">{slot.durationMinutes} min</td>
                <td className="num">
                  {slot.booked} / {slot.capacity}
                </td>
                <td>
                  <form action={remove}>
                    <input type="hidden" name="viewingId" value={slot.id} />
                    <button
                      className="admin-btn admin-btn-sm admin-btn-danger"
                      type="submit"
                      // Deleting notifies everyone booked — worth saying
                      // before the click, not after.
                      title={
                        slot.booked > 0
                          ? `${slot.booked} booked; they will be emailed that it is cancelled.`
                          : undefined
                      }
                    >
                      Cancel
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="admin-form" action={formAction} noValidate>
        {state?.message ? (
          <p className="admin-notice" data-tone={state.errors ? "error" : "ok"} role="alert">
            {state.message}
          </p>
        ) : null}

        <div className="admin-grid-2">
          <Field id="slot-startsAt" name="startsAt"
            label="Starts"
            error={errors.startsAt}
            hint="Local time (Europe/Sofia)."
          >
            {(props) => <input {...props} type="datetime-local" />}
          </Field>

          <Field id="slot-kind" name="kind" label="Kind" error={errors.kind}>
            {(props) => (
              <select {...props} defaultValue="open_house">
                <option value="open_house">Open house</option>
                <option value="private">Private appointment</option>
              </select>
            )}
          </Field>

          <Field id="slot-durationMinutes" name="durationMinutes" label="Length (minutes)" error={errors.durationMinutes}>
            {(props) => <input {...props} type="number" min={5} max={480} defaultValue={30} />}
          </Field>

          <Field id="slot-capacity" name="capacity"
            label="Places"
            error={errors.capacity}
            hint="Bookings are refused once this is reached."
          >
            {(props) => <input {...props} type="number" min={1} max={200} defaultValue={6} />}
          </Field>
        </div>

        <div className="admin-form-actions">
          <button className="admin-btn" type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add viewing"}
          </button>
        </div>
      </form>
    </section>
  );
}
