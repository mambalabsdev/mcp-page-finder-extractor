# Page Finder and Extractor MCP Server

[![Smithery](https://smithery.ai/badge/mambabuilt/mcp-page-finder-extractor)](https://smithery.ai/servers/mambabuilt/mcp-page-finder-extractor) [![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-page-finder-extractor/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-page-finder-extractor) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-page-finder-extractor%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-page-finder-extractor&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-page-finder-extractor)](https://www.npmjs.com/package/@mambalabsdev/mcp-page-finder-extractor) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-page-finder-extractor)](https://www.npmjs.com/package/@mambalabsdev/mcp-page-finder-extractor) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-page-finder-extractor)](https://github.com/mambalabsdev/mcp-page-finder-extractor/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-page-finder-extractor)

Give it a company domain and name a page type. It finds that page on the company's own website and returns the URL, the method that found it, and a confidence for that method.

46 page types. Discovery vocabulary in 11 European languages. Optionally reads the page and returns structured fields.

Wraps the [Page Finder and Extractor](https://apify.com/mambalabs/page-finder-extractor) actor by [Mamba Labs](https://apify.com/mambalabs).

## Install

```bash
npx -y @mambalabsdev/mcp-page-finder-extractor
```

Requires an Apify API token in `APIFY_TOKEN`. Create one at [console.apify.com/account/integrations](https://console.apify.com/account/integrations).

### Claude Desktop

```json
{
  "mcpServers": {
    "mamba-page-finder-extractor": {
      "command": "npx",
      "args": ["-y", "@mambalabsdev/mcp-page-finder-extractor"],
      "env": {
        "APIFY_TOKEN": "your-apify-token"
      }
    }
  }
}
```

## Tool

### `find_company_page`

| Input | Required | What it does |
|---|---|---|
| `domain` | one of these three | A single company domain, for example `stripe.com` |
| `domains` | one of these three | Several company domains |
| `companies` | one of these three | Companies by name, as `{name, country?, isin?, ticker?, url?}`. Identity resolution runs first and is charged separately |
| `pageTypes` | no | Which of the 46 page types to find. Default `["pricing"]` |
| `mode` | no | `locate` for URLs, `locate_and_extract` to also read the page. Default `locate` |
| `knownUrls` | no | URLs you already hold, keyed by page type. Skips discovery for those |
| `extractionFields` | no | The page agnostic extraction menu |
| `extractPageTypeFields` | no | Also run the field map bound to the page type. Default `"true"` |
| `maxPagesPerType` | no | 1 to 12, candidate pages opened per type. Default `"4"` |
| `maxRequestsPerInput` | no | 5 to 200, ceiling on requests per company. Default `"60"` |
| `allowRender` | no | Open a browser for pages that need JavaScript. Default `"true"` |
| `languageHints` | no | Language codes to try first. Reorders vocabulary, never shortens it |
| `skipCache` | no | `"true"` forces a fresh crawl instead of the 14 day cache |

The 46 page types: `pricing`, `demo_request`, `free_trial`, `procurement_vendor`, `about`, `leadership_team`, `locations`, `investor_relations`, `annual_report`, `governance`, `security_trust_center`, `compliance_certifications`, `privacy_policy`, `terms_of_service`, `dpa_subprocessors`, `accessibility_statement`, `status_page`, `careers`, `job_board`, `benefits`, `culture`, `documentation`, `api_reference`, `integrations`, `changelog`, `roadmap`, `developer_portal`, `blog`, `press_newsroom`, `case_studies`, `customers_logos`, `resources_library`, `events_webinars`, `podcast`, `media_kit`, `partners`, `reseller_channel`, `affiliate_program`, `marketplace_listing`, `community`, `contact`, `support_help_center`, `login_app`, `sustainability_esg`, `diversity_programs`, `giving_volunteering`.

## Reading the output

One flat row per input, always, including the ones where nothing was found.

- `{type}_url` is the located page, for example `pricing_url`.
- `{type}_found` is `true`, `false` or `null`. **These are never collapsed.** `false` means the site was read, its link graph and sitemap were searched, and the page is not there. `null` means not enough was readable to say so.
- `{type}_method` is how it was found: `known_url`, `known_host`, `homepage_anchor`, `footer_anchor`, `section_hop`, `sitemap` or `path_guess`. Precision differs sharply between them.
- `{type}_confidence` is scored for **that method**, not blended. Threshold at 0.8 for anything a customer will see. A `path_guess` never scores above 0.6.
- `coverage` and `fetch_status` say whether the look completed. Read them before trusting a `false`.

In `locate_and_extract` mode the structured fields land in a second `findings` dataset, one record per field, keyed back by `input_key`, because eleven filing rows do not fit in one cell.

## Billing

Pay per event on Apify credits. Roughly, at the FREE tier: $0.004 per page type located, $0.003 per page extracted, $0.007 per company name resolved, and the standard actor start fee.

A look that happens is billed, including the ones that come back empty, because the work is the same either way. A look that does not happen is not billed: a dead domain, a refusal, or a robots.txt disallow returns `found: null` and no locate charge.

You are never charged for identity resolution unless you use the `companies` path.

## What this server does and does not do

It reads publicly available pages on the company's own website. It honors `robots.txt` per host including `Crawl-delay`, makes one request at a time per domain with a delay, and sends a descriptive user agent that names it. It does not impersonate a browser, does not sign headers, and does not retry to get around a block. Where a page is publicly served but needs JavaScript to read, a browser renders it; a browser is never used against an access control.

**Personal data.** Two page types can return a named person: `contact` returns the contact block a company publishes on its own contact page, and `about` returns leadership names published on its own about page. Only what the company published, no inferred attributes, no lookups elsewhere. Those records carry `is_personal_data: true` and a `lawful_basis`, so the whole class filters out with one predicate, or leave `contact` and `about` out of `pageTypes` and none is produced. For a roster of people at a company, use [Team Page People Extractor](https://apify.com/mambalabs/team-page-people-extractor) instead.

This server is read only. It starts an actor run and returns the dataset. It writes nothing anywhere else.

## Mamba Labs GTM Suite

This server is one of the Mamba Labs MCP servers for go-to-market data, each backed by its own actor on the Apify Store. If you would rather install one package than many, [`@mambalabsdev/mcp-gtm-suite`](https://www.npmjs.com/package/@mambalabsdev/mcp-gtm-suite) exposes the suite through a single server.

Browse the whole fleet on the [Apify Store](https://apify.com/mambalabs) or on [npm](https://www.npmjs.com/org/mambalabsdev).

If you want a roster of people at a company rather than a page on its website, use [Team Page People Extractor](https://apify.com/mambalabs/team-page-people-extractor) and [Contact Classifier](https://apify.com/mambalabs/contact-classifier) instead. This actor returns a contact block only when it happens to sit on a page you asked it to find.

## Source

The actor is on the [Apify Store](https://apify.com/mambalabs/page-finder-extractor). This wrapper lives at [github.com/mambalabsdev/mcp-page-finder-extractor](https://github.com/mambalabsdev/mcp-page-finder-extractor) and is [MIT licensed](LICENSE).

Built by [Mamba Labs](https://mambabuilt.com).
