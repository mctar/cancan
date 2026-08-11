import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the AIRCAN experience and social metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AIRCAN — The Wall Is Live<\/title>/i);
  assert.match(html, /ZERO-TOUCH DIGITAL SPRAY WALL/);
  assert.match(html, /YOUR HAND IS THE CAN/);
  assert.match(html, /SYSTEM READY/);
  assert.match(html, /START WITH CAMERA/);
  assert.match(html, /TRY WITH POINTER/);
  assert.match(html, /\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("ships the local hand model and removes the disposable starter", async () => {
  const [page, styles, worker, layout, packageJson, pagesHtml, pagesWorkflow] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/gesture-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../github-pages/index.html", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
    access(new URL("../public/models/gesture_recognizer.task", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
  ]);

  assert.match(worker, /GestureRecognizer\.createFromOptions/);
  assert.match(worker, /forVisionTasks\([^)]*, true\)/);
  assert.match(worker, /modelAssetBuffer/);
  assert.match(worker, /recognizeForVideo/);
  assert.match(page, /gesture-worker\.js/);
  assert.match(page, /CALIBRATION_TARGETS/);
  assert.match(page, /TRACKING LAB/);
  assert.match(page, /Splatter/);
  assert.match(page, /Marker/);
  assert.match(page, /COMMAND MODE/);
  assert.match(page, /hasOpenPalmShape/);
  assert.match(page, /openPalmLastSeenRef/);
  assert.match(page, /commandPinchSinceRef/);
  assert.match(page, /command-confirm-meter/);
  assert.match(page, /latest-loading/);
  assert.match(page, /latest-art/);
  assert.match(styles, /url\("\/og\.png"\) center \/ contain no-repeat/);
  assert.match(styles, /\.mode-intro \.topbar/);
  assert.match(page, /Closed_Fist/);
  assert.match(page, /Victory/);
  assert.match(page, /data-command-id/);
  assert.match(page, /VISION \/ INIT/);
  assert.match(page, /getUserMedia/);
  assert.match(page, /saveArtwork/);
  assert.match(layout, /generateMetadata/);
  assert.match(packageJson, /@mediapipe\/tasks-vision/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(packageJson, /build:pages/);
  assert.match(pagesHtml, /https:\/\/cancan\.btrbot\.com\//);
  assert.match(pagesWorkflow, /actions\/deploy-pages@v4/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", templateRoot)));
});
