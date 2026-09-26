let appPromise;

export default async function handler(req, res) {
  if (!appPromise) {
    appPromise = import("./app.mjs").then((m) => m.default || m);
  }
  const app = await appPromise;
  return app(req, res);
}
