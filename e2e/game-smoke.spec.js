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

  await page.goto("/map.html");
  await expect(page.locator("#breadcrumb")).toContainText("Sol");
  const mapBounds = await page.locator("#mapArea").boundingBox();
  expect(mapBounds).not.toBeNull();
  expect(Math.abs(mapBounds.width - mapBounds.height)).toBeLessThan(1);
  await expect(page.locator("#infoPanel")).toBeHidden();
  await expect(page.locator("#startOverlay")).toBeVisible();
  await expect(page.locator("#turnPanel")).toBeHidden();
  await expect(page.locator(".turnShip")).toHaveCount(0);
  await expect(page.locator("#setupSummary")).toContainText("1 local player · 2 NPC commanders");
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer", "3d", { timeout: 15000 });
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer-state", "active", { timeout: 15000 });
  await expect(page.getByRole("button", { name: "New Game" })).toBeEnabled();
  await page.getByRole("button", { name: "Tutorial" }).click();
  await expect(page.locator("#startOverlay")).toBeHidden();
  await expect(page.locator("#tutorialGuide")).toBeVisible();
  await expect(page.locator(".turnShip")).toHaveCount(3);
  await expect(page.locator(".turnShipState")).toHaveText(["10 Ships", "10 Ships", "10 Ships"]);
  await expect(page.locator(".turnFaction")).toHaveCount(1);
  await expect(page.locator("#turnClock")).toBeHidden();
  await expect(page.locator("#tutorialStep")).toHaveText("Step 1 of 12");
  await expect(page.locator("#tutorialActionTitle")).toHaveText("Select your Fleet");
  await expect(page.locator('[data-tutorial-target="true"]')).toHaveCount(3);
  await expect(page.locator(".turnShip.ready").first()).toHaveAttribute("aria-describedby", "tutorialActionMessage");
  await page.locator("#tutorialExitBtn").click();
  await expect(page.locator("#startOverlay")).toBeVisible();
  await expect(page.locator(".turnShip")).toHaveCount(0);
  await page.getByRole("button", { name: "Tutorial" }).click();
  await page.locator(".turnShip").first().click();
  await expect(page.locator("#tutorialStep")).toHaveText("Step 2 of 12");
  await expect(page.locator("#tutorialActionTitle")).toHaveText("Approach Earth");
  await expect(page.locator('[data-tutorial-target="true"]')).toHaveId("infoForward");
  await expect(page.locator("#infoForward")).toBeInViewport();
  await page.locator("#infoForward").click();
  await expect(page.locator("#tutorialStep")).toHaveText("Step 3 of 12");
  await page.locator("#infoForward").click();
  await expect(page.locator("#tutorialStep")).toHaveText("Step 4 of 12");
  await expect(page.locator("#tutorialActionTitle")).toHaveText("Conquer Earth");
  await expect(page.locator('[data-tutorial-target="true"]')).toHaveId("infoConquer");
  await page.getByRole("button", { name: "Mechanics Library" }).click();
  await expect(page.locator(".tutorialGroup")).toHaveCount(5);
  await page.getByRole("button", { name: "Ships and Fleet Strength" }).click();
  await expect(page.locator("#tutorialMechanics li")).toHaveCount(4);
  await expect(page.locator("#tutorialLibraryExitBtn")).toBeVisible();
  await page.locator("#tutorialLibraryExitBtn").click();
  await expect(page.locator("#startOverlay")).toBeVisible();
  await expect(page.locator(".turnShip")).toHaveCount(0);
  await page.getByRole("button", { name: "New Game" }).click();
  await expect(page.locator("#startOverlay")).toBeHidden();
  await expect(page.locator("#turnPanel")).toBeVisible();
  await expect(page.locator("#turnClock")).toBeHidden();
  await expect(page.locator("#turnHeading")).toContainText("Blue Armada turn");
  await expect(page.locator(".turnShip")).toHaveCount(37);
  await expect(page.locator(".turnShip.ready")).toHaveCount(13);
  await expect(page.locator(".turnFaction")).toHaveCount(3);
  await expect(page.locator(".turnFactionHeader")).toContainText(["Player", "NPC", "NPC"]);
  await expect(page.getByRole("button", { name: /Fleet B1 Ready, 19 Ships/ })).toBeVisible();
  await expect(page.locator(".turnShipState").first()).toContainText("19 Ships");
  await page.locator("#turnPanelToggle").click();
  await expect(page.locator("#turnPanelToggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#turnFactions")).toBeHidden();
  await page.locator("#turnPanelToggle").click();
  await expect(page.locator("#turnPanelToggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#turnFactions")).toBeVisible();
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer", "3d");
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer-state", "active");
  await expect(page.locator("#mapwrap3d")).toBeVisible();
  await expect(page.locator("#mapwrap")).toBeHidden();
  await expect(page.locator("#cv3d")).toHaveAttribute("data-renderer", "three");
  await expect(page.locator("#cv3d")).toHaveAttribute("data-renderer-state", "active");
  await expect(page.locator("#cv3d")).toHaveAttribute("data-graphics-quality", /^(low|high)$/);
  await expect(page.locator("#cv3d")).toHaveAttribute("data-static-builds", "2");
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
  await expect(page.locator("#infoPanel button")).toHaveCount(11);
  await expect(page.locator("#infoSplit")).toBeVisible();
  await expect(page.locator("#infoMerge")).toBeHidden();
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
  await expect(page.locator("#cv3d")).toHaveAttribute("data-static-builds", "2");

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
  await expect(page.locator("#cv3d")).toHaveAttribute("data-static-builds", "3");
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
  await expect(page.locator("#startOverlay")).toBeVisible();
  await expect(page.locator("#turnPanel")).toBeHidden();
  await expect(page.locator("#hint")).toContainText("forced by the URL");
  await page.locator("#playerCount").selectOption("2");
  await page.locator("#npcCount").selectOption("0");
  await expect(page.locator("#setupSummary")).toContainText("2 local players · 0 NPC commanders · 2 Armadas");
  await page.getByRole("button", { name: "New Game" }).click();
  await expect(page.locator("#turnHeading")).toContainText("Blue Armada turn");
  await expect(page.locator(".turnShip")).toHaveCount(7);
  await expect(page.locator(".turnFaction")).toHaveCount(2);
  await expect(page.locator("#turnClock")).toBeVisible();
  await expect(page.locator("#turnClock")).toContainText("remaining");
  await expect(page.locator("#mapwrap")).toBeVisible();
  await expect(page.locator("#mapwrap3d")).toBeHidden();
  expect(sceneRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("Set Course advances visibly one hex at a time", async ({ page }) => {
  await page.goto("/map.html?renderer=2d");
  await page.getByRole("button", { name: "Tutorial" }).click();

  await page.getByRole("button", { name: /Fleet B1 Ready, 10 Ships/ }).click();
  await page.locator("#infoForward").click();
  await page.locator("#infoForward").click();
  await page.getByRole("button", { name: /Conquer Earth/ }).click();

  await page.getByRole("button", { name: /Fleet B2 Ready, 10 Ships/ }).click();
  await page.locator("#infoTurnL").click();
  await page.locator("#infoForward").click();
  await page.locator("#infoEnd").click();

  await page.getByRole("button", { name: /Fleet B3 Ready, 10 Ships/ }).click();
  await page.locator("#infoTravel").click();
  const canvas = page.locator("#starmapCv");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.5);
  await expect(page.locator("#tutorialActionTitle")).toHaveText("End the final activation");
  await page.locator("#infoEnd").click();

  const mapArea = page.locator("#mapArea");
  await expect(mapArea).toHaveAttribute("data-course-animation", "active");
  await expect(mapArea).toHaveAttribute("data-course-step", "1");
  await page.waitForTimeout(100);
  await expect(mapArea).toHaveAttribute("data-course-step", "1");
  await expect.poll(async () => Number(await mapArea.getAttribute("data-course-step"))).toBeGreaterThan(1);
  await expect(mapArea).toHaveAttribute("data-course-animation", "idle");
});

test("split Fleets can merge back into an already-acted flagship Fleet", async ({ page }) => {
  await page.goto("/map.html?renderer=2d");
  await page.getByRole("button", { name: "Tutorial" }).click();
  await page.getByRole("button", { name: /Fleet B1 Ready, 10 Ships/ }).click();
  await page.locator("#infoForward").click();
  await page.locator("#infoForward").click();
  await page.getByRole("button", { name: /Conquer Earth/ }).click();

  await page.getByRole("button", { name: /Fleet B2 Ready, 10 Ships/ }).click();
  await page.locator("#infoEnd").click();
  await page.getByRole("button", { name: /Fleet B3 Ready, 10 Ships/ }).click();
  await page.locator("#infoEnd").click();

  await page.getByRole("button", { name: /Fleet B1 Ready, 7 Ships/ }).click();
  await page.locator("#infoSplit").click();
  await expect(page.getByRole("button", { name: /Fleet B1 Acted, 4 Ships/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Fleet B4 Acted, 3 Ships/ })).toBeVisible();

  await page.getByRole("button", { name: /Fleet B2 Ready, 10 Ships/ }).click();
  await page.locator("#infoEnd").click();
  await page.getByRole("button", { name: /Fleet B3 Ready, 10 Ships/ }).click();
  await page.locator("#infoEnd").click();
  await page.getByRole("button", { name: /Fleet B1 Ready, 4 Ships/ }).click();
  await page.locator("#infoEnd").click();
  await page.getByRole("button", { name: /Fleet B4 Ready, 3 Ships/ }).click();
  await expect(page.locator("#infoMerge")).toBeVisible();
  await page.locator("#infoMerge").click();

  const flagship = page.getByRole("button", { name: /Fleet B1 Acted, 7 Ships/ });
  await expect(flagship).toBeVisible();
  await expect(flagship).toContainText("★");
  await expect(page.getByRole("button", { name: /Fleet B4 Destroyed, 0 Ships/ })).toBeVisible();
  await expect(page.locator('.turnShip[aria-pressed="true"]')).toHaveCount(0);
});

test("a failed 3D bundle load reports the cause and falls back to 2D", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/*", route => /\/scene3d(?:-|\.js)/.test(new URL(route.request().url()).pathname)
    ? route.abort("failed")
    : route.continue());

  await page.goto("/map.html");
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer", "2d");
  await expect(page.locator("#mapArea")).toHaveAttribute("data-renderer-error", /scene3d(?:-|\.js)/);
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
