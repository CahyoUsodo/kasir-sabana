export const APP_VERSION = __APP_VERSION__;
export const APP_BUILD_TIME = __APP_BUILD_TIME__;
export const APP_COMMIT_HASH = __APP_COMMIT_HASH__;

export const formatAppBuildTime = () =>
  new Date(APP_BUILD_TIME).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
