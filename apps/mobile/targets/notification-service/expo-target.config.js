/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "notification-service",
  name: "NotificationServiceExtension",
  bundleIdentifier: ".NotificationServiceExtension",
  frameworks: ["UserNotifications", "Intents"],
  deploymentTarget: "16.0",
  entitlements: {
    "com.apple.developer.usernotifications.communication": true,
  },
});
