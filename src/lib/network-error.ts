/**
 * True when `e` looks like the browser's fetch() itself failing to complete a
 * round trip (dropped connection, proxy timeout, aborted request) rather than
 * a real error our own server function threw and returned.
 *
 * fetch() only ever rejects for a network-layer failure -- a response that
 * arrives with an error status (4xx/5xx) still resolves the fetch, and our
 * server-fn client turns that into a proper thrown Error with our own
 * message. There is no single spec'd error type/message for a network
 * failure, but every major engine uses one of a small, well-known set of
 * strings for it.
 *
 * This matters for destructive mutations in particular: a network failure
 * means the request may well have completed on the server (the write already
 * committed) before the response was lost in transit. The caller must not
 * treat this the same as a real, well-formed failure response.
 */
const NETWORK_FAILURE_MESSAGES = [
  "load failed", // Safari
  "failed to fetch", // Chrome / Edge
  "networkerror when attempting to fetch resource", // Firefox
  "network request failed", // React Native / misc
  "the internet connection appears to be offline", // Safari, offline
];

export function isNetworkFailure(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return NETWORK_FAILURE_MESSAGES.some((m) => msg.includes(m));
}
