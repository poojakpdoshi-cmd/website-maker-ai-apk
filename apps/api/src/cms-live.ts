export type CmsProjectFile = {
  path: string;
  content: string;
};

const runtimeSource = String.raw`
(function () {
  var config = window.__WEBFORGE_CMS__;
  var lastVersion = '';

  function textValue(object, keys) {
    if (!object || typeof object !== 'object') return '';

    for (var index = 0; index < keys.length; index += 1) {
      var value = object[keys[index]];

      if (
        typeof value === 'string' ||
        typeof value === 'number'
      ) {
        return String(value);
      }
    }

    return '';
  }

  function updatePage(documents) {
    var pathname = location.pathname
      .replace(/^\/+|\/+$/g, '') || 'home';

    var pages = documents.filter(function (document) {
      return document.collection === 'pages';
    });

    var page =
      pages.find(function (document) {
        return document.slug === pathname;
      }) ||
      pages.find(function (document) {
        return document.slug === 'home';
      });

    if (page) {
      var content = page.content || {};
      var seo = page.seo || {};

      var heading = textValue(content, [
        'heading',
        'title',
        'name'
      ]);

      var description = textValue(content, [
        'description',
        'tagline',
        'body',
        'text'
      ]);

      var headingElement =
        document.querySelector('.hero h1, header h1, h1');

      var descriptionElement =
        document.querySelector('.hero p, header p');

      if (heading && headingElement) {
        headingElement.textContent = heading;
      }

      if (description && descriptionElement) {
        descriptionElement.textContent = description;
      }

      var seoTitle = textValue(seo, ['title']);
      var seoDescription =
        textValue(seo, ['description']);

      if (seoTitle) {
        document.title = seoTitle;
      }

      if (seoDescription) {
        var meta =
          document.querySelector(
            'meta[name="description"]'
          );

        if (!meta) {
          meta = document.createElement('meta');
          meta.setAttribute('name', 'description');
          document.head.appendChild(meta);
        }

        meta.setAttribute(
          'content',
          seoDescription
        );
      }
    }
  }

  function renderCollections(documents) {
    var main =
      document.querySelector('main') ||
      document.body;

    [
      'products',
      'blog',
      'services',
      'testimonials',
      'faqs'
    ].forEach(function (collection) {
      var items = documents.filter(
        function (document) {
          return document.collection === collection;
        }
      );

      var sectionId =
        'webforge-cms-' + collection;

      var existing =
        document.getElementById(sectionId);

      if (!items.length) {
        if (existing) existing.remove();
        return;
      }

      var section =
        existing || document.createElement('section');

      section.id = sectionId;
      section.setAttribute(
        'data-webforge-cms',
        collection
      );

      section.innerHTML = '';

      var heading = document.createElement('h2');

      heading.textContent =
        collection.charAt(0).toUpperCase() +
        collection.slice(1);

      var grid = document.createElement('div');

      grid.style.display = 'grid';
      grid.style.gridTemplateColumns =
        'repeat(auto-fit,minmax(220px,1fr))';
      grid.style.gap = '18px';

      section.appendChild(heading);
      section.appendChild(grid);

      items.forEach(function (item) {
        var content = item.content || {};
        var card = document.createElement('article');

        card.style.padding = '18px';
        card.style.border =
          '1px solid rgba(128,128,128,.25)';
        card.style.borderRadius = '16px';

        var imageUrl = textValue(content, [
          'image',
          'imageUrl',
          'photo'
        ]);

        if (imageUrl) {
          var image = document.createElement('img');

          image.src = imageUrl;
          image.alt =
            textValue(content, ['alt']) ||
            item.title ||
            '';

          image.loading = 'lazy';
          image.style.width = '100%';
          image.style.borderRadius = '12px';

          card.appendChild(image);
        }

        var title = document.createElement('h3');

        title.textContent =
          textValue(content, [
            'name',
            'title',
            'heading'
          ]) ||
          item.title ||
          '';

        card.appendChild(title);

        var description = textValue(content, [
          'description',
          'body',
          'text',
          'answer'
        ]);

        if (description) {
          var paragraph =
            document.createElement('p');

          paragraph.textContent = description;
          card.appendChild(paragraph);
        }

        var price = textValue(content, [
          'price',
          'amount'
        ]);

        if (price) {
          var priceElement =
            document.createElement('strong');

          priceElement.textContent = price;
          card.appendChild(priceElement);
        }

        grid.appendChild(card);
      });

      if (!existing) {
        main.appendChild(section);
      }
    });
  }

  async function refreshCms() {
    try {
      var endpoint =
        config.apiBase +
        '/public/cms/' +
        encodeURIComponent(config.publicSlug);

      var response = await fetch(endpoint, {
        cache: 'no-store'
      });

      if (!response.ok) return;

      var data = await response.json();
      var version =
        String(data.contentVersion || '');

      if (version && version === lastVersion) {
        return;
      }

      lastVersion = version;

      var documents =
        Array.isArray(data.documents)
          ? data.documents
          : [];

      updatePage(documents);
      renderCollections(documents);
    } catch (_) {
      // Original generated website remains available.
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      refreshCms
    );
  } else {
    refreshCms();
  }

  setTimeout(refreshCms, 1200);
  setInterval(refreshCms, 30000);
})();
`;

export function injectCmsRuntime<
  T extends CmsProjectFile
>(
  files: T[],
  apiBase: string,
  publicSlug: string
): T[] {
  const config = JSON.stringify({
    apiBase: apiBase.replace(/\/$/, ''),
    publicSlug
  }).replace(/</g, '\\u003c');

  const script =
    `<script data-webforge-cms>` +
    `window.__WEBFORGE_CMS__=${config};` +
    runtimeSource +
    `</script>`;

  return files.map((file) => {
    if (
      file.path !== 'index.html' ||
      file.content.includes(
        'data-webforge-cms'
      )
    ) {
      return file;
    }

    const content =
      /<\/body>/i.test(file.content)
        ? file.content.replace(
            /<\/body>/i,
            `${script}</body>`
          )
        : `${file.content}${script}`;

    return {
      ...file,
      content
    };
  });
}
