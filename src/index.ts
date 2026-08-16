#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  // memory=4096 is deliberate and is NOT the fleet default for this call.
  //
  // run-sync-get-dataset-items runs at 2048 MB unless told otherwise, which for
  // every other Mamba Labs wrapper is a harmless CEILING: those actors default
  // to 256 or 512. This actor defaults to 4096 because it launches a real
  // browser to render pages that serve no readable HTML, so 2048 is a silent
  // HALVING of what the actor asks for, and it showed up in the validation gate
  // as an apify-actor-start count of 2 where the actor's own README works the
  // per run cost out at 4.
  //
  // Passing it explicitly restores the actor's declared default rather than
  // departing from it. Keep this in step with defaultRunOptions.memoryMbytes on
  // the actor.
  const url = `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?timeout=300&memory=4096`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${APIFY_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(input),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }

    let message: string;
    switch (response.status) {
      case 400:
        message = `The ${actorLabel} run was rejected as invalid input.${detail}`;
        break;
      case 401:
        message = "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
        break;
      case 402:
        message =
          "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
        break;
      case 408:
        message = `The ${actorLabel} run timed out after 300 seconds. Ask for fewer companies or fewer page types per call, or run the actor on Apify directly for larger jobs.`;
        break;
      default:
        message = `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
    return { isError: true, content: [{ type: "text", text: message }] };
  }

  // A 2xx from run-sync-get-dataset-items normally carries the dataset array.
  // Anything else on this path is a failure the caller must see, never an empty
  // success: surfacing it here is what keeps a failed run from reading as "no
  // results found".
  let items: unknown;
  try {
    items = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
  }

  if (!Array.isArray(items)) {
    const asObj = items as { error?: { type?: string; message?: string } };
    const detail = asObj?.error?.message
      ? `${asObj.error.message}`
      : JSON.stringify(items);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

const PAGE_TYPES = [
  "pricing", "demo_request", "free_trial", "procurement_vendor",
  "about", "leadership_team", "locations", "investor_relations", "annual_report", "governance",
  "security_trust_center", "compliance_certifications", "privacy_policy", "terms_of_service",
  "dpa_subprocessors", "accessibility_statement", "status_page",
  "careers", "job_board", "benefits", "culture",
  "documentation", "api_reference", "integrations", "changelog", "roadmap", "developer_portal",
  "blog", "press_newsroom", "case_studies", "customers_logos", "resources_library",
  "events_webinars", "podcast", "media_kit",
  "partners", "reseller_channel", "affiliate_program", "marketplace_listing", "community",
  "contact", "support_help_center", "login_app",
  "sustainability_esg", "diversity_programs", "giving_volunteering",
] as const;

const server = new McpServer({
  name: "mamba-page-finder-extractor",
  version: pkg.version,
});

// Page Finder and Extractor (immutable actor ID TpurgcOZbVnknlaiC)
server.registerTool(
  "find_company_page",
  {
    title: "Find Company Page",
    description:
      "Give it a company domain and name a page type. It finds that page on the company's own website and returns the URL, the method that found it, and a confidence for THAT method. 46 page types are available: pricing, investor_relations, security_trust_center, careers, about, contact, terms_of_service, privacy_policy, partners, integrations, documentation, api_reference, status_page, changelog, press_newsroom, customers_logos, sustainability_esg and 29 more. Discovery reads the homepage and footer link graph, the sitemap and its shards, known third party hosts such as boards.greenhouse.io and statuspage.io, and anchor vocabulary in 11 European languages; guessing a URL path is the LAST method tried and is scored 0.6 or below. Read {type}_confidence and threshold at 0.8 for anything a customer will see, and read coverage and fetch_status before trusting a false: found=false means the site was read and the page is not there, found=null means not enough was readable to say, and the two are never collapsed. Set mode to locate_and_extract to also read the page and return structured fields, which costs an extra event per page. Every input returns exactly one row, including the empty ones. Requires an APIFY_TOKEN and consumes Apify credits. Read only.",
    annotations: {
      title: "Find Company Page",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      domain: z.string().optional().describe("A single company domain, for example stripe.com. Protocol and path are stripped. Supply this or domains or companies."),
      domains: z.array(z.string()).optional().describe("Several company domains. Every one returns a row, including the ones where nothing is found."),
      companies: z.array(z.object({
        name: z.string().describe("Company name."),
        country: z.string().optional().describe("ISO country code, improves resolution."),
        isin: z.string().optional(),
        ticker: z.string().optional(),
        url: z.string().optional().describe("A URL you already hold. Supplying it skips identity resolution and its charge."),
      })).optional().describe("Companies you have a name for but not a domain. Identity resolution runs first on this path and is charged as its own event. Use domains instead whenever you hold a domain."),
      pageTypes: z.array(z.enum(PAGE_TYPES)).optional().describe("Which page types to locate. Each one costs a locate event and adds requests, so ask for what you will use. Default: [\"pricing\"]."),
      mode: z.enum(["locate", "locate_and_extract"]).optional().describe("locate returns the page URL, the method and a confidence. locate_and_extract also reads the page and returns structured fields into a second findings dataset. Default: \"locate\"."),
      knownUrls: z.record(z.string()).optional().describe("URLs you already hold, keyed by page type, for example {\"pricing\": \"https://stripe.com/pricing\"}. Discovery is skipped for that page type, which is faster and exact."),
      extractionFields: z.array(z.enum([
        "copyright", "legal_entity", "emails", "phones", "addresses", "social_links",
        "meta", "last_modified", "canonical", "schema_org", "forms", "ctas", "tech_markers",
      ])).optional().describe("The page agnostic extraction menu, available on any page type. Only used in locate_and_extract mode. Omit for all of them."),
      extractPageTypeFields: z.enum(["true", "false"]).optional().describe("true also runs the field map bound to the page type: pricing plans, filing rows and a derived fiscal year end, certifications, ATS host, governing law. Only used in locate_and_extract mode. Default: \"true\"."),
      maxPagesPerType: z.string().optional().describe("Between 1 and 12. Candidate pages opened per page type before giving up. Lowering it is faster and finds less. Sent as a string so it works from Clay. Default: \"4\"."),
      maxRequestsPerInput: z.string().optional().describe("Between 5 and 200. Hard ceiling on requests to one company's site. Hitting it returns coverage partial rather than a false negative. Sent as a string. Default: \"60\"."),
      allowRender: z.enum(["true", "false"]).optional().describe("true opens a browser for pages that serve no readable HTML, which is most Nordic investor calendars. A browser is never used against a block, a CAPTCHA, a login or robots.txt. Default: \"true\"."),
      languageHints: z.array(z.string()).optional().describe("Language codes to try first, for example [\"de\",\"fr\"]. Vocabulary is multilingual by default in all 11 languages; this only reorders it and never shortens it."),
      concurrency: z.string().optional().describe("How many companies to work on at once. Per company the actor is still strictly one request at a time with a delay, so this does not make it impolite to any single site. Sent as a string. Default: \"10\"."),
      skipCache: z.enum(["false", "true"]).optional().describe("false uses the 14 day cache. true forces a fresh crawl. Default: \"false\"."),
    },
  },
  async (args) =>
    runActor("TpurgcOZbVnknlaiC", "Page Finder and Extractor", compact(args as Record<string, unknown>)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
