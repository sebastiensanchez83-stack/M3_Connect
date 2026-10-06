// Retired on 6 Oct 2026. This public function (no auth, CORS *) created an
// already-confirmed account with a password of the caller's choosing for any
// e-mail address, which bypasses Auth "Confirm email". Nothing in the app calls
// it. It now refuses every request; delete it from the dashboard when convenient
// (Edge Functions -> create-demo-user -> Delete). The old code is in git history.

Deno.serve(() =>
  new Response(JSON.stringify({ error: "This endpoint has been retired." }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
