(function () {
  'use strict';

  /* -------------------------------------------------
     Listings data
     Single source of truth for the homepage's featured
     lot + lots grid, and this detail page. Each image
     entry is either a real photo path or "gradient:<css-class>"
     for lots that don't have a real photo yet.
  ------------------------------------------------- */
  var LISTINGS = [
    {
      id: '011',
      type: 'auction',
      status: null,
      featured: true,
      ribbonEmbedded: true,
      title: 'Двустаен апартамент в Кършияка',
      location: 'Кършияка, Пловдив',
      address: 'ул. Съборна 14, Кършияка, Пловдив, България',
      images: ['assets/images/dvustaen-ribbon.jpg'],
      meta: [
        { bg: '2 Стаи', en: '2 Rooms' },
        { bg: '1 Баня', en: '1 Bath' },
        { bg: '65 кв.м', en: '65 sqm' },
        { bg: 'Етаж 4', en: 'Floor 4' },
        { bg: 'Построена 1986', en: 'Built 1986' }
      ],
      bidType: 'opening',
      price: '€100,000',
      nextMinBid: '€100,000',
      increment: '€2,000',
      closeDate: '2026-08-02T19:00:00+03:00',
      descriptionBg: 'Светъл двустаен апартамент в утвърден квартал на Пловдив, само на няколко минути от центъра. Обновена баня и кухня, PVC дограма и юг-изток изложение. Отличен вариант за живеене или отдаване под наем.',
      descriptionEn: 'A bright two-room apartment in an established Plovdiv neighborhood, minutes from the city center. Renovated bathroom and kitchen, PVC joinery, and a south-east exposure. A strong option for owner-occupancy or rental income.'
    },
    {
      id: '012',
      type: 'auction',
      status: 'closing',
      title: 'Cliffside Modern',
      location: 'Big Sur, California',
      address: '1 Cliffside Terrace, Big Sur, CA 93920, USA',
      images: ['gradient:lot-image-2'],
      meta: [
        { bg: '4 Спални', en: '4 Bed' },
        { bg: '5 Бани', en: '5 Bath' },
        { bg: '483 кв.м', en: '5,200 sqft' },
        { bg: 'Построена 2018', en: 'Built 2018' }
      ],
      bidType: 'current',
      price: '$6,820,000',
      nextMinBid: '$6,870,000',
      increment: '$50,000',
      closeDate: '2026-07-26T18:00:00-04:00',
      descriptionBg: 'Кантилевърна модерна къща от стъкло и стомана, надвиснала над Тихия океан. Обширни прозорци от пода до тавана и открит план улавят светлината и гледката през целия ден.',
      descriptionEn: 'A cantilevered glass-and-steel modern home suspended above the Pacific. Expansive floor-to-ceiling glazing and an open plan capture light and ocean views throughout the day.'
    },
    {
      id: '013',
      type: 'auction',
      status: null,
      title: 'Pemberton Manor',
      location: 'Litchfield County, Connecticut',
      address: '22 Pemberton Road, Litchfield County, CT 06759, USA',
      images: ['gradient:lot-image-3'],
      meta: [
        { bg: '8 Спални', en: '8 Bed' },
        { bg: '9 Бани', en: '9 Bath' },
        { bg: '1,124 кв.м', en: '12,100 sqft' },
        { bg: 'Построена 1932', en: 'Built 1932' }
      ],
      bidType: 'current',
      price: '$3,275,000',
      nextMinBid: '$3,300,000',
      increment: '$25,000',
      closeDate: '2026-07-30T18:00:00-04:00',
      descriptionBg: 'Тухлено имение в грузториански стил с формални градини, разположено на частен парцел от над два акра. Оригинални первази, библиотека с дървена ламперия и порти на каретите.',
      descriptionEn: 'A brick Georgian-style estate with formal gardens set on a private two-plus acre parcel. Original moldings, a wood-paneled library, and a carriage house round out the grounds.'
    },
    {
      id: '014',
      type: 'auction',
      status: 'new',
      title: 'Silo Loft Collection',
      location: 'River North, Chicago',
      address: '410 W Grand Ave, River North, Chicago, IL 60654, USA',
      images: ['gradient:lot-image-4'],
      meta: [
        { bg: '3 Апартамента', en: '3 Units' },
        { bg: '2 Бани всеки', en: '2 Bath ea.' },
        { bg: '223 кв.м всеки', en: '2,400 sqft ea.' },
        { bg: 'Построена 1947', en: 'Built 1947' }
      ],
      bidType: 'opening',
      price: '$980,000',
      nextMinBid: '$980,000',
      increment: '$10,000',
      closeDate: '2026-08-05T18:00:00-04:00',
      descriptionBg: 'Три преустроени индустриални лофта в историческа сграда на River North. Изложени тухли и греди, високи тавани и отделни входове за всеки апартамент.',
      descriptionEn: 'Three converted industrial lofts in a historic River North building. Exposed brick and beams, soaring ceilings, and a separate entrance for each unit.'
    },
    {
      id: '015',
      type: 'auction',
      status: null,
      title: 'Vale House',
      location: 'Ojai Valley, California',
      address: '88 Vale Canyon Road, Ojai, CA 93023, USA',
      images: ['gradient:lot-image-5'],
      meta: [
        { bg: '5 Спални', en: '5 Bed' },
        { bg: '4 Бани', en: '4 Bath' },
        { bg: '432 кв.м', en: '4,650 sqft' },
        { bg: 'Построена 1962', en: 'Built 1962' }
      ],
      bidType: 'current',
      price: '$2,410,000',
      nextMinBid: '$2,430,000',
      increment: '$20,000',
      closeDate: '2026-08-09T18:00:00-04:00',
      descriptionBg: 'Средновековна къща, вписана в горист парцел в долината Оджай. Ниски покривни линии, вътрешни дворове и оригинални теракотени подове от епохата на строителството.',
      descriptionEn: 'A mid-century home nestled into a wooded Ojai Valley parcel. Low roof lines, courtyard breezeways, and original terracotta flooring from the era of construction.'
    },
    {
      id: '016',
      type: 'auction',
      status: 'new',
      title: 'The Obsidian Residence',
      location: 'Joshua Tree, California',
      address: '5 Obsidian Way, Joshua Tree, CA 92252, USA',
      images: ['gradient:lot-image-6'],
      meta: [
        { bg: '3 Спални', en: '3 Bed' },
        { bg: '3 Бани', en: '3 Bath' },
        { bg: '288 кв.м', en: '3,100 sqft' },
        { bg: 'Построена 2020', en: 'Built 2020' }
      ],
      bidType: 'opening',
      price: '$1,650,000',
      nextMinBid: '$1,650,000',
      increment: '$15,000',
      closeDate: '2026-08-15T18:00:00-04:00',
      descriptionBg: 'Черна бетонна резиденция, проектирана да изчезва в пустинния пейзаж през деня и да свети отвътре през нощта. Частен басейн и наблюдателна палуба за звезди.',
      descriptionEn: 'A black concrete residence designed to disappear into the desert by day and glow from within at night. A private pool and a stargazing deck complete the lot.'
    },
    {
      id: '017',
      type: 'auction',
      status: null,
      title: 'Harbor Point',
      location: 'Camden, Maine',
      address: '3 Harbor Point Lane, Camden, ME 04843, USA',
      images: ['gradient:lot-image-7'],
      meta: [
        { bg: '5 Спални', en: '5 Bed' },
        { bg: '6 Бани', en: '6 Bath' },
        { bg: '585 кв.м', en: '6,300 sqft' },
        { bg: 'Построена 1998', en: 'Built 1998' }
      ],
      bidType: 'current',
      price: '$3,890,000',
      nextMinBid: '$3,920,000',
      increment: '$30,000',
      closeDate: '2026-08-20T18:00:00-04:00',
      descriptionBg: 'Къща в стил „shingle“ на самия ръб на пристанището в Камдън, с частен кей. Веранди, обвиващи фасадата, и изглед към залива от почти всяка стая.',
      descriptionEn: 'A shingle-style home on the edge of Camden Harbor with a private dock. Wraparound porches and bay views from nearly every room.'
    }
  ];

  var STATUS_LABEL = {
    closing: { bg: 'Скоро Приключва', en: 'Closing Soon' },
    new: { bg: 'Нова Обява', en: 'New Listing' }
  };

  var TYPE_LABEL = {
    auction: { bg: 'Търг', en: 'Auction' },
    private: { bg: 'Частна Продажба', en: 'Private Listing' }
  };

  var BID_LABEL = {
    current: { bg: 'Текуща Оферта', en: 'Current Bid' },
    opening: { bg: 'Начална Оферта', en: 'Opening Bid' }
  };

  function bilingual(bg, en) {
    return '<span data-bg>' + bg + '</span><span data-en>' + en + '</span>';
  }

  function findListing(id) {
    for (var i = 0; i < LISTINGS.length; i++) {
      if (LISTINGS[i].id === id) return LISTINGS[i];
    }
    return null;
  }

  function similarListings(listing, count) {
    return LISTINGS.filter(function (l) {
      return l.type === listing.type && l.id !== listing.id;
    }).slice(0, count);
  }

  /* -------------------------------------------------
     Image helper — real photo path or gradient placeholder
  ------------------------------------------------- */
  function imageMarkup(entry, altText, extraClass) {
    var cls = 'lot-image' + (extraClass ? ' ' + extraClass : '');
    if (entry.indexOf('gradient:') === 0) {
      var gradientClass = entry.slice('gradient:'.length);
      return '<div class="' + cls + ' ' + gradientClass + '" role="img" aria-label="' + altText + '"></div>';
    }
    return '<img class="' + cls + ' lot-image-photo" src="' + entry + '" alt="' + altText + '" />';
  }

  /* -------------------------------------------------
     Homepage-style lot card (reused for "Similar properties")
  ------------------------------------------------- */
  function renderLotCard(listing) {
    var tag = bilingual('ЛОТ ' + listing.id, 'LOT ' + listing.id);
    var statusBadge = '';
    if (listing.status && STATUS_LABEL[listing.status]) {
      var s = STATUS_LABEL[listing.status];
      var statusClass = listing.status === 'closing' ? 'lot-status-closing' : 'lot-status-new';
      statusBadge = '<span class="lot-status ' + statusClass + '">' + bilingual(s.bg, s.en) + '</span>';
    }

    var metaHtml = listing.meta.slice(0, 3).map(function (m) {
      return '<span>' + bilingual(m.bg, m.en) + '</span>';
    }).join('');

    var bidLabel = BID_LABEL[listing.bidType];

    return (
      '<article class="lot-card" data-close="' + listing.closeDate + '">' +
        '<div class="lot-card-media">' +
          '<a href="property.html?id=' + listing.id + '" aria-label="' + listing.title + '">' +
            '<span class="lot-tag">' + tag + '</span>' +
            imageMarkup(listing.images[0], listing.title) +
          '</a>' +
          statusBadge +
        '</div>' +
        '<div class="lot-card-body">' +
          '<h3 class="lot-title"><a href="property.html?id=' + listing.id + '">' + listing.title + '</a></h3>' +
          '<p class="lot-location">' + listing.location + '</p>' +
          '<div class="lot-meta">' + metaHtml + '</div>' +
          '<div class="lot-price-row">' +
            '<div><span class="lot-price-label">' + bilingual(bidLabel.bg, bidLabel.en) + '</span><span class="lot-price">' + listing.price + '</span></div>' +
            '<div class="lot-countdown-wrap"><span class="lot-price-label">' + bilingual('Приключва След', 'Closes In') + '</span><span class="lot-countdown" data-countdown>--:--:--:--</span></div>' +
          '</div>' +
          '<a class="btn btn-outline btn-full" href="property.html?id=' + listing.id + '">' + bilingual('Виж Лот ' + listing.id, 'View Lot ' + listing.id) + '</a>' +
        '</div>' +
      '</article>'
    );
  }

  /* -------------------------------------------------
     Detail page sections
  ------------------------------------------------- */
  function renderBreadcrumb() {
    return (
      '<a class="breadcrumb" href="index.html#lots">' +
        '<span aria-hidden="true">&larr;</span> ' +
        bilingual('Назад към Обектите', 'Back to Listings') +
      '</a>'
    );
  }

  function renderGallery(listing) {
    var mainImage = imageMarkup(listing.images[0], listing.title, 'gallery-main-image');
    var tag = listing.featured
      ? bilingual('ЛОТ ' + listing.id + ' · Специална Оферта', 'LOT ' + listing.id + ' · Featured')
      : bilingual('ЛОТ ' + listing.id, 'LOT ' + listing.id);

    var thumbs = '';
    if (listing.images.length > 1) {
      thumbs = '<div class="gallery-thumbs">' + listing.images.map(function (img, i) {
        return '<button type="button" class="gallery-thumb' + (i === 0 ? ' is-active' : '') + '" data-image-index="' + i + '">' +
          imageMarkup(img, listing.title + ' ' + (i + 1)) +
        '</button>';
      }).join('') + '</div>';
    }

    return (
      '<div class="gallery">' +
        '<div class="gallery-main">' +
          '<span class="lot-tag">' + tag + '</span>' +
          mainImage +
        '</div>' +
        thumbs +
      '</div>'
    );
  }

  function renderHeader(listing) {
    var typeLabel = TYPE_LABEL[listing.type];
    return (
      '<div class="property-header">' +
        '<span class="property-type-tag">' + bilingual(typeLabel.bg, typeLabel.en) + '</span>' +
        '<h1 class="property-title">' + listing.title + '</h1>' +
        '<p class="property-location">' + listing.location + '</p>' +
      '</div>'
    );
  }

  function renderPricePanel(listing) {
    if (listing.type === 'private') {
      return (
        '<div class="price-panel">' +
          '<div class="price-panel-main">' +
            '<span class="lot-price-label">' + bilingual('Искана Цена', 'Asking Price') + '</span>' +
            '<span class="price-panel-value">' + listing.price + '</span>' +
          '</div>' +
          '<a class="btn btn-brass btn-lg btn-full" href="#cta">' + bilingual('Заяви Оглед', 'Request Viewing') + '</a>' +
        '</div>'
      );
    }

    var bidLabel = BID_LABEL[listing.bidType];
    var incrementNote = listing.bidType === 'opening'
      ? bilingual(
          'Първата оферта трябва да е поне ' + listing.nextMinBid + '.',
          'The first bid must be at least ' + listing.nextMinBid + '.'
        )
      : bilingual(
          'Следваща минимална оферта: ' + listing.nextMinBid + ' (стъпка от ' + listing.increment + ').',
          'Next minimum bid: ' + listing.nextMinBid + ' (increments of ' + listing.increment + ').'
        );

    return (
      '<div class="price-panel" data-close="' + listing.closeDate + '">' +
        '<div class="price-panel-row">' +
          '<div class="price-panel-main">' +
            '<span class="lot-price-label">' + bilingual(bidLabel.bg, bidLabel.en) + '</span>' +
            '<span class="price-panel-value">' + listing.price + '</span>' +
          '</div>' +
          '<div class="price-panel-countdown">' +
            '<span class="lot-price-label">' + bilingual('Приключва След', 'Closes In') + '</span>' +
            '<span class="lot-countdown price-panel-countdown-value" data-countdown>--:--:--:--</span>' +
          '</div>' +
        '</div>' +
        '<p class="bid-increment-note">' + incrementNote + '</p>' +
        '<a class="btn btn-brass btn-lg btn-full" href="#cta">' + bilingual('Наддай Сега', 'Place Bid') + '</a>' +
      '</div>'
    );
  }

  function renderKeyDetails(listing) {
    var items = listing.meta.map(function (m) {
      return '<div class="key-detail"><span class="key-detail-value">' + bilingual(m.bg, m.en) + '</span></div>';
    }).join('');
    return '<div class="key-details">' + items + '</div>';
  }

  function renderDescription(listing) {
    return (
      '<div class="property-description">' +
        '<h2 class="section-title">' + bilingual('Описание', 'Description') + '</h2>' +
        '<p>' + bilingual(listing.descriptionBg, listing.descriptionEn) + '</p>' +
      '</div>'
    );
  }

  function renderLocationSection(listing) {
    return (
      '<div class="property-location-section">' +
        '<h2 class="section-title">' + bilingual('Локация', 'Location') + '</h2>' +
        '<p class="property-address">' + listing.address + '</p>' +
        '<div class="map-placeholder">' +
          bilingual('Тук ще бъде вградена карта', 'Map embed will go here') +
        '</div>' +
      '</div>'
    );
  }

  function renderSimilar(listing) {
    var similar = similarListings(listing, 3);
    if (similar.length === 0) return '';

    return (
      '<section class="similar-properties">' +
        '<h2 class="section-title">' + bilingual('Подобни Обекти', 'Similar Properties') + '</h2>' +
        '<div class="lots-grid">' + similar.map(renderLotCard).join('') + '</div>' +
      '</section>'
    );
  }

  function renderNotFound() {
    return (
      '<div class="property-not-found">' +
        '<h1>' + bilingual('Обектът не е намерен', 'Listing not found') + '</h1>' +
        '<p>' + bilingual('Този лот вече не е наличен или връзката е невалидна.', 'This lot is no longer available, or the link is invalid.') + '</p>' +
        '<a class="btn btn-brass" href="index.html#lots">' + bilingual('Обратно към Обектите', 'Back to Listings') + '</a>' +
      '</div>'
    );
  }

  /* -------------------------------------------------
     Init
  ------------------------------------------------- */
  function init() {
    var root = document.getElementById('property-root');
    if (!root) return;

    var params = new URLSearchParams(window.location.search);
    var id = params.get('id');
    var listing = id ? findListing(id) : null;

    if (!listing) {
      root.innerHTML = renderBreadcrumb() + renderNotFound();
      return;
    }

    document.title = listing.title + ' — Auction House';

    root.innerHTML =
      renderBreadcrumb() +
      '<div class="property-layout">' +
        '<div class="property-main">' +
          renderGallery(listing) +
          renderHeader(listing) +
          renderKeyDetails(listing) +
          renderDescription(listing) +
          renderLocationSection(listing) +
        '</div>' +
        '<div class="property-side">' +
          renderPricePanel(listing) +
        '</div>' +
      '</div>' +
      renderSimilar(listing);

    // Gallery thumbnail switching
    var mainImageEl = root.querySelector('.gallery-main .lot-image');
    root.querySelectorAll('.gallery-thumb').forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        var index = Number(thumb.getAttribute('data-image-index'));
        var entry = listing.images[index];
        if (!mainImageEl || !entry) return;

        var replacement = imageMarkup(entry, listing.title, 'gallery-main-image');
        mainImageEl.outerHTML = replacement;
        mainImageEl = root.querySelector('.gallery-main .lot-image');

        root.querySelectorAll('.gallery-thumb').forEach(function (t) {
          t.classList.toggle('is-active', t === thumb);
        });
      });
    });

    if (window.AuctionHouse && window.AuctionHouse.initCountdowns) {
      window.AuctionHouse.initCountdowns(root);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
