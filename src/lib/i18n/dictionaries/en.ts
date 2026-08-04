import type { Dictionary } from "./bg";

/*
 * Typed as `Dictionary`, so a key added to bg.ts and forgotten here is a
 * build failure rather than a page that renders "undefined".
 */
export const en: Dictionary = {
  site: {
    name: "Auction House",
    tagline: "Real estate auctions",
    skipToContent: "Skip to content",
  },
  nav: {
    lots: "Lots",
    howItWorks: "How it works",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    switchToOther: "Български",
    switchLabel: "Switch language to Bulgarian",
    themeToLight: "Light theme",
    themeToDark: "Dark theme",
  },
  lots: {
    heading: "Current lots",
    eyebrow: "Catalogue",
    count: { one: "{n} lot", other: "{n} lots" },
    empty: "There are no active lots at the moment.",
    emptyHint: "Check back soon — new lots are published regularly.",
  },
  lot: {
    chip: "LOT",
    viewLot: "View lot {n}",
    openingBid: "Opening bid",
    currentBid: "Current bid",
    closesIn: "Closes in",
    biddingOpensIn: "Bidding opens in",
    closed: "Closed",
    biddingClosed: "Bidding closed",
    badgePreview: "Preview",
    badgeClosingSoon: "Closing soon",
    badgeExtending: "Extended",
    rooms: { one: "{n} room", other: "{n} rooms" },
    areaSqm: "{n} sqm",
    floor: "Floor {n}",
    yearBuilt: "Built {n}",
  },
  detail: {
    backToLots: "Back to lots",
    description: "Description",
    location: "Location",
    keyDetails: "Key details",
    mapPlaceholder: "Map embed will go here",
    similar: "Similar properties",
    keyDates: "Key dates",
    previewFrom: "Preview from",
    biddingOpens: "Bidding opens",
    scheduledClose: "Scheduled close",
    closedOn: "Closed on",
    biddingOpensNote: "Bidding opens on {date}.",
    biddingClosedNote: "Bidding on this lot has closed.",
    increment: "Bid increment: {amount}",
  },
  propertyType: {
    apartment: "Apartment",
    house: "House",
    land: "Land",
    commercial: "Commercial",
    other: "Other",
  },
  notFound: {
    title: "Lot not found",
    body: "This lot does not exist, or is no longer public.",
    cta: "View all lots",
  },
  footer: {
    rights: "All rights reserved.",
  },
};
