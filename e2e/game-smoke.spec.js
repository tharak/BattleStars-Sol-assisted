import { expect, test } from "@playwright/test";

test("the tactical battle boots and starts a scenario", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("/battle.html");
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator("button.scenario").first()).toBeVisible();

  await page.locator('input[name="deploymode"][value="1"]').check();
  await page.locator("button.scenario").first().click();

  await expect(page.locator("#battle")).toBeVisible();
  await expect(page.locator("#cv")).toBeVisible();
  await expect(page.locator("#status")).not.toBeEmpty();
  expect(pageErrors).toEqual([]);
});

test("the strategic map boots the bundled Three.js renderer", async ({ page }) => {
  const pageErrors = [];
  const runtimeCdnRequests = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    if (request.url().includes("cdn.jsdelivr.net") || request.url().includes("unpkg.com")) {
      runtimeCdnRequests.push(request.url());
    }
  });

  await page.goto("/map.html");
  await expect(page.locator("#breadcrumb")).toContainText("Sol");
  await expect(page.locator("#infoPanel")).toBeVisible();
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer", "3d");
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer-state", "active");
  await expect(page.locator("#mapwrap3d")).toBeVisible();
  await expect(page.locator("#mapwrap")).toBeHidden();
  await expect(page.locator("#cv3d")).toHaveAttribute("data-renderer", "three");
  await expect(page.locator("#cv3d")).toHaveAttribute("data-renderer-state", "active");
  await expect(page.locator("#cv3d")).toHaveAttribute("data-graphics-quality", /^(low|high)$/);
  await expect(page.locator("#cv3d")).toHaveAttribute("data-static-builds", "1");
  expect(await page.locator("#cv3d").evaluate(canvas =>
    !!canvas.getContext("webgl2") || !!canvas.getContext("webgl")
  )).toBe(true);
  expect(runtimeCdnRequests).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.locator("#cv3d").hover({ position: { x: 80, y: 80 } });
  await expect(page.locator("#cv3d")).toHaveAttribute("data-static-builds", "1");

  await page.locator("#cv3d").evaluate(canvas =>
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }))
  );
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer-state", "lost");
  await expect(page.locator("#hint")).toContainText("context was lost");

  await page.locator("#cv3d").evaluate(canvas =>
    canvas.dispatchEvent(new Event("webglcontextrestored"))
  );
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer-state", "active");
  await expect(page.locator("#hint")).toContainText("graphics restored");
  await expect(page.locator("#cv3d")).toHaveAttribute("data-static-builds", "2");
});

test("the strategic map keeps an intentional 2D fallback path", async ({ page }) => {
  const pageErrors = [];
  const sceneRequests = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    if (/\/assets\/scene3d-[^/]+\.js$/.test(new URL(request.url()).pathname)) {
      sceneRequests.push(request.url());
    }
  });

  await page.goto("/map.html?renderer=2d");
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer", "2d");
  await expect(page.locator("#mapwrap")).toBeVisible();
  await expect(page.locator("#mapwrap3d")).toBeHidden();
  await expect(page.locator("#hint")).toContainText("forced by the URL");
  expect(sceneRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("a failed 3D bundle load reports the cause and falls back to 2D", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/assets/scene3d-*.js", route => route.abort("failed"));

  await page.goto("/map.html");
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer", "2d");
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer-error", /scene3d-/);
  await expect(page.locator("#mapwrap")).toBeVisible();
  await expect(page.locator("#hint")).toContainText("3D renderer error:");
  expect(pageErrors).toEqual([]);
});

test("the strategic map can force its constrained-device quality tier", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("/map.html?quality=low");
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer", "3d");
  await expect(page.locator("#cv3d")).toHaveAttribute("data-graphics-quality", "low");
  expect(pageErrors).toEqual([]);
});
