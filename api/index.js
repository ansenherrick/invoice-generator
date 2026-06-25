let appPromise;

const getApp = async () => {
  if (!appPromise) {
    appPromise = import("../apps/api/dist/app.js").then(({ createApp }) => createApp());
  }

  return appPromise;
};

module.exports = async (request, response) => {
  const app = await getApp();
  return app(request, response);
};
