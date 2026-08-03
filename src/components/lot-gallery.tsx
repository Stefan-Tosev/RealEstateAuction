"use client";

import { useState } from "react";
import type { PublicImage } from "@/server/catalogue/types";
import { LotImage } from "./lot-image";

const MAIN_SIZES = "(max-width: 1024px) 100vw, 62vw";

/*
 * Main image plus thumbnails, carrying forward v1's gallery. Client-side
 * because selecting a thumbnail is local state; v1 did the same thing by
 * swapping outerHTML, which lost the element's event bindings and had to
 * re-query it afterwards.
 *
 * Thumbnails only appear when there is more than one image — with a
 * single photo a lone thumbnail underneath it is noise. (v1 had the same
 * rule, though no listing ever had a second image to trigger it.)
 */
export function LotGallery({
  images,
  gradientClass,
  title,
  lotChip,
}: {
  images: PublicImage[];
  gradientClass: string;
  title: string;
  lotChip: string;
}) {
  const [active, setActive] = useState(0);
  const current = images[active] ?? null;

  return (
    <div className="gallery">
      <div className="gallery-main">
        <span className="lot-tag">{lotChip}</span>
        <LotImage
          image={current}
          gradientClass={gradientClass}
          alt={title}
          sizes={MAIN_SIZES}
          priority
        />
      </div>

      {images.length > 1 ? (
        <div className="gallery-thumbs">
          {images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              className="gallery-thumb"
              aria-current={index === active}
              aria-label={image.alt || title}
              onClick={() => setActive(index)}
            >
              <LotImage
                image={image}
                gradientClass={gradientClass}
                alt=""
                sizes="96px"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
