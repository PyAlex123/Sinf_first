import type { Component } from 'svelte';

/**
 * Tiny History-API router: route patterns with `:param`, lazily loaded pages, link interception.
 * Kept in-house to stay within the bundle budget (CLAUDE.md §3.1).
 */

export type PageProps = { params: Record<string, string>; query: URLSearchParams };
export type PageModule = { default: Component<PageProps> };

export interface RouteDef {
  pattern: string;
  load: () => Promise<PageModule>;
}

interface CompiledRoute extends RouteDef {
  regex: RegExp;
  keys: string[];
}

export interface Match {
  route: RouteDef;
  params: Record<string, string>;
  query: URLSearchParams;
  path: string;
}

export function compile(route: RouteDef): CompiledRoute {
  const keys: string[] = [];
  const source = route.pattern
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { ...route, regex: new RegExp(`^${source}/?$`), keys };
}

export function matchPath(routes: readonly CompiledRoute[], url: string): Match | undefined {
  const [pathPart = '/', queryPart = ''] = url.split('?');
  const path = pathPart === '' ? '/' : pathPart;
  for (const route of routes) {
    const found = route.regex.exec(path);
    if (!found) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, i) => {
      params[key] = decodeURIComponent(found[i + 1] ?? '');
    });
    // Query params are read-only for pages; no need for SvelteURLSearchParams here.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    return { route, params, query: new URLSearchParams(queryPart), path };
  }
  return undefined;
}

class Router {
  current = $state.raw<Match | undefined>(undefined);
  page = $state.raw<Component<PageProps> | undefined>(undefined);
  notFound = $state(false);
  private routes: CompiledRoute[] = [];
  private loadId = 0;

  start(routes: RouteDef[]): void {
    this.routes = routes.map(compile);
    window.addEventListener('popstate', () => void this.resolve());
    document.addEventListener('click', (event) => {
      const anchor = (event.target as Element | null)?.closest('a');
      if (
        !anchor ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download') ||
        anchor.origin !== location.origin
      ) {
        return;
      }
      event.preventDefault();
      this.navigate(anchor.pathname + anchor.search);
    });
    void this.resolve();
  }

  navigate(url: string, options: { replace?: boolean } = {}): void {
    if (options.replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    void this.resolve();
  }

  private async resolve(): Promise<void> {
    const id = ++this.loadId;
    const match = matchPath(this.routes, location.pathname + location.search);
    if (!match) {
      this.current = undefined;
      this.page = undefined;
      this.notFound = true;
      return;
    }
    const mod = await match.route.load();
    if (id !== this.loadId) return; // a newer navigation won
    this.current = match;
    this.page = mod.default;
    this.notFound = false;
    window.scrollTo(0, 0);
  }
}

export const router = new Router();
