import { useSearchParams, useNavigate } from 'react-router-dom';
import { useCallback, useMemo } from 'react';

/**
 * Reusable hook for URL-based admin filtering.
 * Every admin tab reads/writes filters via URL search params so that:
 *  - Dashboard KPI clicks land on the right page pre-filtered
 *  - Filters survive browser refresh
 *  - Bookmarkable filtered views
 */
export function useAdminFilters<T extends Record<string, string>>() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  /** Read a single filter param */
  const getFilter = useCallback(
    (key: string, fallback = ''): string => searchParams.get(key) || fallback,
    [searchParams],
  );

  /** Read all non-empty filter params as an object */
  const filters = useMemo(() => {
    const obj: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (value) obj[key] = value;
    });
    return obj as Partial<T>;
  }, [searchParams]);

  /** True if at least one filter is active */
  const hasFilters = useMemo(
    () => Array.from(searchParams.entries()).some(([, v]) => !!v),
    [searchParams],
  );

  /** Set one or more filters (merges with existing) */
  const setFilters = useCallback(
    (update: Partial<T>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(update).forEach(([k, v]) => {
          if (v) next.set(k, v as string);
          else next.delete(k);
        });
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  /** Clear all filters */
  const clearFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  /** Navigate to another admin tab with pre-set filters */
  const navigateWithFilters = useCallback(
    (path: string, params?: Record<string, string>) => {
      const qs = params
        ? '?' + new URLSearchParams(params).toString()
        : '';
      navigate(`${path}${qs}`);
    },
    [navigate],
  );

  return {
    filters,
    hasFilters,
    getFilter,
    setFilters,
    clearFilters,
    navigateWithFilters,
  };
}
