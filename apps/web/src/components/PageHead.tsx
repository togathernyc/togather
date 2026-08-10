import type { ReactNode } from "react";
import type { PageMeta } from "../routes.tsx";

/**
 * Sets the document <title> and meta description for a route on client-side
 * navigation. React 19 hoists <title>/<meta> tags rendered anywhere in the
 * tree into <head>, so this needs no portal or effect — it just renders them
 * alongside the page. The static tags in index.html only cover the very
 * first paint of "/"; every navigation after that goes through here.
 */
export function PageHead({ meta, children }: { meta: PageMeta; children: ReactNode }) {
  return (
    <>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      {children}
    </>
  );
}
