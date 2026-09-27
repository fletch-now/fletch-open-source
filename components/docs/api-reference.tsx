import type { ReactElement } from "react";
import { DocsSection, DocsTitle, Snippet } from "@/components/docs/prose";
import { DocsAiAccess } from "@/components/docs/ai-access";
import { DocsNext, DocsVerification } from "@/components/docs/document";
import { API_TAGS, openApiDocument } from "@/lib/api/openapi";

interface Operation {
  summary?: string;
  description?: string;
  tags?: readonly string[];
  security?: readonly unknown[];
  "x-required-scope"?: string;
  parameters?: unknown;
  requestBody?: unknown;
  responses?: unknown;
}

function JsonDefinition({
  title,
  value,
}: {
  title: string;
  value: unknown;
}): ReactElement | null {
  if (!value) return null;
  return (
    <section className="mt-5">
      <h4 className="mb-2 text-[13px] font-medium text-ink">{title}</h4>
      <Snippet>{JSON.stringify(value, null, 2)}</Snippet>
    </section>
  );
}

export function ApiReference({ embedded = false }: { embedded?: boolean }): ReactElement {
  const operations = Object.entries(openApiDocument.paths).flatMap(
    function pathOperations([path, item]) {
      return Object.entries(item)
        .filter(([method]) =>
          ["get", "post", "put", "patch", "delete", "head", "options"].includes(
            method,
          ),
        )
        .map(([method, operation]) => ({
          path,
          method,
          operation: operation as Operation,
        }));
    },
  );
  return (
    <article>
      <DocsTitle
        embedded={embedded}
        lede={`${operations.length} operations generated at build time from the same OpenAPI document served by this API. Expand an endpoint for its parameters, body and response definitions.`}
      >
        API reference
      </DocsTitle>
      {!embedded ? <DocsAiAccess /> : null}
      {!embedded ? <DocsVerification /> : null}
      <DocsSection title="Base URL and authentication" embedded={embedded}>
        <p>
          Base URL:{" "}
          <code className="font-mono text-[13px]">
            {openApiDocument.servers[0].url}
          </code>
          . Public operations have an empty security array. Keyed operations
          name their required scope. Create a Fletch key in Dashboard Settings
          and send it as a bearer token.
        </p>
        <Snippet>{`curl --fail-with-body --silent --show-error \\
  -H "Authorization: Bearer $FLETCH_API_KEY" \\
  ${openApiDocument.servers[0].url}/watchers`}</Snippet>
        <p>
          Schema references use the named definitions at the bottom of this
          page. The complete JSON and interactive explorer are also available.
        </p>
        <p>
          <a
            className="underline underline-offset-4"
            href="/api/v1/openapi.json"
          >
            OpenAPI JSON
          </a>{" "}
          ·{" "}
          <a className="underline underline-offset-4" href="/api/v1/docs">
            Interactive API explorer
          </a>
        </p>
      </DocsSection>
      {API_TAGS.map(function tagSection(tag) {
        const entries = operations.filter(
          ({ operation }) => (operation.tags?.[0] ?? "Chains") === tag.name,
        );
        if (entries.length === 0) return null;
        return (
          <DocsSection key={tag.name} title={tag.name} embedded={embedded}>
            <p>{tag.description}</p>
            {entries.map(function endpoint({ path, method, operation }) {
              return (
                <details
                  key={`${method}:${path}`}
                  data-api-operation={`${method.toUpperCase()} ${path}`}
                  className="border-b border-line pb-3"
                >
                  <summary className="cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood">
                    <span className="break-all font-mono text-[12px] text-ink">
                      {method.toUpperCase()} {path}
                    </span>
                    <span className="mt-1 block text-[13px] text-ink-soft">
                      {operation.summary}
                    </span>
                  </summary>
                  {operation.description ? (
                    <p className="mb-3">{operation.description}</p>
                  ) : null}
                  <p className="text-[12px] text-ink-faint">
                    {operation.security?.length === 0
                      ? "Public"
                      : `Authentication required${operation["x-required-scope"] ? `: ${operation["x-required-scope"]}` : ""}`}
                  </p>
                  <JsonDefinition
                    title="Parameters"
                    value={operation.parameters}
                  />
                  <JsonDefinition
                    title="Request body"
                    value={operation.requestBody}
                  />
                  <JsonDefinition
                    title="Responses"
                    value={operation.responses}
                  />
                </details>
              );
            })}
          </DocsSection>
        );
      })}
      <DocsSection title="Named schemas" embedded={embedded}>
        {Object.entries(openApiDocument.components.schemas).map(
          ([name, schema]) => (
            <details
              key={name}
              id={`schema-${name}`}
              className="border-b border-line pb-3"
            >
              <summary className="cursor-pointer py-3 font-mono text-[13px] text-ink">
                {name}
              </summary>
              <Snippet>{JSON.stringify(schema, null, 2)}</Snippet>
            </details>
          ),
        )}
      </DocsSection>
      {!embedded ? <DocsNext slug="limits" /> : null}
    </article>
  );
}
