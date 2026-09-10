// Placeholder worker entrypoint. Section 7 replaces this with the HTTP server
// (POST /jobs, GET /healthz) and the job runner. For now it just proves the
// tsx toolchain and the workspace wiring.
function main(): void {
  console.log("worker up");
}

main();
process.exit(0);
