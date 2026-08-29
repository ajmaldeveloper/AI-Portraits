import { useEffect, useState } from "react";
import { useLocation } from "react-router";

// `<s-button href="...">` navigation does not surface through React
// Router's `useNavigation()` in this embedded context — it never
// reports a pending state for it. So loading here is tracked locally:
// show it the instant the button is clicked, and clear it the instant
// the URL actually changes (arrival, redirect, or error all count) —
// never a fixed timer.

/**
 * Loading state for one href-based navigation button.
 */
export function useNavigatingTo() {
  const location = useLocation();

  const [clicked, setClicked] = useState(false);

  useEffect(() => {
    setClicked(false);
    // Resetting must only depend on location identity — including
    // `clicked` here would cancel a click the instant it's set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  return {
    loading: clicked,
    onClick: () => setClicked(true),
  };
}

/**
 * Same idea, for a component that renders several navigation buttons
 * at once (tabs, a row's action menu) and needs to know specifically
 * which one was clicked.
 */
export function useNavLoadingGroup<Key extends string>() {
  const location = useLocation();

  const [pending, setPending] = useState<Key | null>(null);

  useEffect(() => {
    setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  return {
    isLoading: (key: Key) => pending === key,
    start: (key: Key) => setPending(key),
  };
}
