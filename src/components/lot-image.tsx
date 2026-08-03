import Image from "next/image";
import type { PublicImage } from "@/server/catalogue/types";

/*
 * A photograph when there is one, v1's gradient placeholder when there
 * is not. Every seeded property has images, so the fallback is
 * defensive — but a lot published before its photos are uploaded still
 * has to render, and a broken-image icon on a luxury listing is worse
 * than an abstract gradient.
 *
 * The gradient branch keeps v1's role="img" + aria-label: a placeholder
 * standing in for a photograph still conveys "there is an image here",
 * and screen-reader users should know what it depicts.
 */
export function LotImage({
  image,
  gradientClass,
  alt,
  sizes,
  priority = false,
  className,
}: {
  image: PublicImage | null;
  gradientClass: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const classes = ["lot-image", className].filter(Boolean).join(" ");

  if (!image) {
    return <div className={`${classes} ${gradientClass}`} role="img" aria-label={alt} />;
  }

  return (
    <Image
      className={`${classes} lot-image-photo`}
      src={image.url}
      alt={image.alt || alt}
      // Intrinsic dimensions come from the database, which is why the
      // columns are required — without them next/image cannot reserve
      // space and every card shifts on load.
      width={image.width}
      height={image.height}
      sizes={sizes}
      priority={priority}
    />
  );
}
