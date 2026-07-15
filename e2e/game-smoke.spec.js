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

test("the strategic map boots the bundled Three.js renderer", async ({ page }, testInfo) => {
  const pageErrors = [];
  const runtimeCdnRequests = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    if (request.url().includes("cdn.jsdelivr.net") || request.url().includes("unpkg.com")) {
      runtimeCdnRequests.push(request.url());
    }
  });

  await page.goto("/map.html?testClock=frozen");
  await expect(page.locator("#breadcrumb")).toContainText("Sol");
  const mapBounds = await page.locator("#mapArea").boundingBox();
  expect(mapBounds).not.toBeNull();
  expect(Math.abs(mapBounds.width - mapBounds.height)).toBeLessThan(1);
  await expect(page.locator("#infoPanel")).toBeHidden();
  await expect(page.locator("#turnPanel")).toBeVisible();
  await expect(page.locator("#turnHeading")).toContainText("Blue Armada turn");
  await expect(page.locator(".turnShip")).toHaveCount(36);
  await expect(page.locator(".turnShip.ready")).toHaveCount(12);
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer", "3d");
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer-state", "active");
  await expect(page.locator("#mapwrap3d")).toBeVisible();
  await expect(page.locator("#mapwrap")).toBeHidden();
  await expect(page.locator("#cv3d")).toHaveAttribute("data-renderer", "three");
  await expect(page.locator("#cv3d")).toHaveAttribute("data-renderer-state", "active");
  await expect(page.locator("#cv3d")).toHaveAttribute("data-graphics-quality", /^(low|high)$/);
  await expect(page.locator("#cv3d")).toHaveAttribute("data-static-builds", "1");
  const firstRosterShip = page.locator(".turnShip").first();
  if (testInfo.project.name === "mobile-chromium") {
    const box = await firstRosterShip.boundingBox();
    expect(box).not.toBeNull();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await firstRosterShip.click();
  }
  await expect(page.locator(".turnShip").first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#infoPanel")).toBeVisible();
  await expect(page.locator("#infoPanel select")).toHaveCount(0);
  await expect(page.locator("#infoPanel button")).toHaveCount(8);
  if (testInfo.project.name === "desktop-chromium") {
    await page.locator(".turnShip").nth(1).click();
    await expect(page.locator(".turnShip").nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.locator(".turnShip").first().click();
    await expect(page.locator(".turnShip").first()).toHaveAttribute("aria-pressed", "true");

    const groupMove = page.locator("#infoGroupMove");
    await groupMove.click();
    await expect(groupMove).toHaveAttribute("aria-pressed", "true");
    const turnLeft = page.locator("#infoTurnL");
    await turnLeft.click();
    await expect(groupMove).toHaveAttribute("aria-pressed", "true");
    await groupMove.click();
    await expect(groupMove).toHaveAttribute("aria-pressed", "false");
    await expect(groupMove).toContainText("Move command group");
    await groupMove.click();
    await expect(groupMove).toHaveAttribute("aria-pressed", "true");
    await turnLeft.click();
    await turnLeft.click();
    await page.locator("#infoEnd").click();
    await expect(page.locator(".turnShip").first()).toContainText("Acted");
    await expect(page.locator("#infoPanel")).toBeHidden();

    for (const [rosterIndex, nextTurn] of [[12, "Red Armada turn"], [24, "Blue Armada turn"]]) {
      await page.locator(".turnShip").nth(rosterIndex).click();
      await page.locator("#infoGroupMove").click();
      await page.locator("#infoTurnL").click();
      await page.locator("#infoEnd").click();
      await expect(page.locator("#turnHeading")).toContainText(nextTurn);
    }

    await page.locator(".turnShip").first().click();
    await expect(groupMove).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#hint")).toContainText("command-group move restored");
  }
  expect(await page.locator("#cv3d").evaluate(canvas =>
    !!canvas.getContext("webgl2") || !!canvas.getContext("webgl")
  )).toBe(true);
  expect(runtimeCdnRequests).toEqual([]);
  expect(pageErrors).toEqual([]);

  // Dispatch at a real canvas-relative point without requiring Playwright
  // to scroll the 950px canvas into a narrow mobile viewport. A physical
  // locator.hover can be intercepted by the surrounding page there even
  // though WebGL is active; this still exercises the canvas mousemove path
  // whose invariant matters here: sparse hover overlays must not rebuild
  // the retained static scene.
  await page.locator("#cv3d").evaluate((canvas, position) => {
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      clientX: rect.left + position.x,
      clientY: rect.top + position.y,
    }));
  }, { x: 80, y: 80 });
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
  await expect(page.locator("#turnHeading")).toContainText("Blue Armada turn");
  await expect(page.locator(".turnShip")).toHaveCount(36);
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
