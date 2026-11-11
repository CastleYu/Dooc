import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Web } from "./keys";

type DocRow = { doc_id: string; title: string; path: string };
type NavItem = { id: string; title: string; href: string };
type NavGroup = { key: string; label: string; items: NavItem[] };

function isExternal(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function routeOf(path: string): string | null {
  const norm = path.replace(/\\/g, "/").replace(/\.mdx?$/i, "");
  if (norm === "docs/index") return "/";
  if (!norm.startsWith("docs/")) return null;
  return `/${norm.slice("docs/".length)}`;
}

export function buildNav(docs: DocRow[], linkDirs: string[], built: Set<string> | null = null): NavGroup[] {
  const linked = linkDirs.map((dir) => dir.replace(/\\/g, "/"));
  const groups = new Map<string, NavGroup>();
  const ensure = (key: string, label: string) => {
    let group = groups.get(key);
    if (!group) {
      group = { key, label, items: [] };
      groups.set(key, group);
    }
    return group;
  };
  for (const doc of docs) {
    const path = doc.path.replace(/\\/g, "/");
    if (path === "docs/index.md") continue;
    const title = doc.title || path.split("/").pop() || doc.doc_id;
    if (!isExternal(path) && path.startsWith("docs/")) {
      const route = routeOf(path);
      if (!route || route === "/") continue;
      const href = built && !built.has(route) ? `/library?doc=${encodeURIComponent(doc.doc_id)}` : route;
      const rel = path.slice("docs/".length);
      const slash = rel.lastIndexOf("/");
      const folder = slash === -1 ? "" : rel.slice(0, slash);
      ensure(folder ? `docs:${folder}` : "docs", folder || "文档").items.push({
        id: doc.doc_id,
        title,
        href,
      });
      continue;
    }
    let best = "";
    for (const dir of linked) {
      if ((path === dir || path.startsWith(`${dir}/`)) && dir.length > best.length) best = dir;
    }
    const key = best || path.slice(0, path.lastIndexOf("/")) || path;
    const label = key.split("/").filter(Boolean).pop() || key;
    ensure(key, label).items.push({
      id: doc.doc_id,
      title,
      href: `/library?doc=${encodeURIComponent(doc.doc_id)}`,
    });
  }
  const list = [...groups.values()];
  for (const group of list) group.items.sort((a, b) => a.title.localeCompare(b.title, "zh"));
  const counts = new Map<string, number>();
  for (const group of list) counts.set(group.label, (counts.get(group.label) ?? 0) + 1);
  for (const group of list) {
    if ((counts.get(group.label) ?? 0) > 1 && isExternal(group.key)) group.label = group.key;
  }
  list.sort((a, b) => {
    const rank = (key: string) => (key === "docs" ? 0 : key.startsWith("docs:") ? 1 : 2);
    return rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, "zh");
  });
  return list;
}

function pathnameOf(href: string): string {
  try {
    return new URL(href, window.location.origin).pathname.replace(/\/$/, "") || "/";
  } catch {
    return "";
  }
}

export default function DocNav() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [groups, setGroups] = useState<NavGroup[] | null>(null);
  const [here, setHere] = useState("");
  const builtRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    let lastHost: HTMLElement | null = null;
    const place = () => {
      const aside = document.querySelector(".rp-doc-layout__sidebar") as HTMLElement | null;
      const next = `${window.location.pathname}${window.location.search}`;
      setHere((prev) => (prev === next ? prev : next));
      if (aside && builtRef.current === null) {
        const hrefs = [...aside.querySelectorAll("a[href]")]
          .filter((anchor) => !anchor.closest(".dooc-doc-nav"))
          .map((anchor) => pathnameOf(anchor.getAttribute("href") || ""))
          .filter((href) => href.startsWith("/"));
        if (hrefs.length) {
          builtRef.current = new Set(hrefs);
          window.dispatchEvent(new Event("dooc-nav-refresh"));
        }
      }
      if (aside === lastHost) return;
      lastHost = aside;
      setHost(aside);
    };
    place();
    const timer = window.setInterval(place, 400);
    window.addEventListener("popstate", place);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("popstate", place);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let stamp = "";
    const load = async () => {
      try {
        const [docsRes, linksRes] = await Promise.all([
          fetch(`${Web.api}/api/docs`),
          fetch(`${Web.api}/api/links`),
        ]);
        if (!docsRes.ok) return;
        const docsBody = await docsRes.json();
        const linksBody = linksRes.ok ? await linksRes.json() : { directories: [] };
        const docs = Array.isArray(docsBody.documents) ? docsBody.documents : [];
        const dirs = Array.isArray(linksBody.directories)
          ? linksBody.directories.map((dir: { path?: string }) => String(dir.path ?? ""))
          : [];
        const next = buildNav(docs, dirs, builtRef.current);
        const fresh = JSON.stringify(next);
        if (stopped || fresh === stamp) return;
        stamp = fresh;
        setGroups(next);
      } catch {
        /* keep the built-in sidebar when the index cannot be read */
      }
    };
    load();
    const timer = window.setInterval(load, 3000);
    const refresh = () => {
      stamp = "";
      load();
    };
    window.addEventListener("dooc-nav-refresh", refresh);
    window.addEventListener("dooc-doc-saved", refresh);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("dooc-nav-refresh", refresh);
      window.removeEventListener("dooc-doc-saved", refresh);
    };
  }, []);

  useEffect(() => {
    if (!host) return;
    host.classList.toggle("dooc-nav-ready", Boolean(groups));
    return () => host.classList.remove("dooc-nav-ready");
  }, [host, groups]);

  if (!host || !groups) return null;

  const current = new URL(here || window.location.href, window.location.origin);

  return createPortal(
    <nav className="dooc-doc-nav" aria-label="文档目录">
      {groups.map((group) => (
        <section key={group.key}>
          <h2>{group.label}</h2>
          <ul>
            {group.items.map((item) => {
              const url = new URL(item.href, window.location.origin);
              const active = url.pathname === current.pathname && url.search === current.search;
              return (
                <li key={item.id}>
                  <a
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={(event) => {
                      const id = url.searchParams.get("doc");
                      if (!id || url.pathname !== "/library") return;
                      if (window.location.pathname !== "/library") return;
                      event.preventDefault();
                      window.history.pushState({}, "", item.href);
                      setHere(`${window.location.pathname}${window.location.search}`);
                      window.dispatchEvent(new CustomEvent("dooc-open-doc", { detail: id }));
                    }}
                  >
                    {item.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>,
    host,
  );
}
