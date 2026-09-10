/** Live-view selection follows OAuth popups and returns to their opener when they close. */
import { expect, it } from "vitest";
import { selectLoginPage } from "./browser";
it("selects the OAuth popup instead of its opener", () => {
  expect(
    selectLoginPage({
      pages: [
        { title: "Claude", debuggerFullscreenUrl: "opener" },
        { title: "Google", debuggerFullscreenUrl: "popup" },
      ],
    }).url,
  ).toBe("popup");
});
it("returns to the opener after the popup closes", () => {
  expect(
    selectLoginPage({
      pages: [{ title: "Claude", debuggerFullscreenUrl: "opener" }],
    }).url,
  ).toBe("opener");
});
it("uses the session view when page metadata is unavailable", () => {
  expect(selectLoginPage({ debuggerFullscreenUrl: "session" }).url).toBe(
    "session",
  );
});
