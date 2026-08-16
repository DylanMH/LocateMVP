const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Config plugin to allow cleartext HTTP traffic.
 *
 * Android 9+ blocks plain HTTP by default. The OVH backend uses http://
 * (not https://), so we need:
 * 1. android:usesCleartextTraffic="true" on the <application> tag
 * 2. An <intent> query for the http scheme so the app can resolve HTTP URLs
 *
 * The `android.usesCleartextTraffic` flag in app.json does not always
 * get applied by expo prebuild, so this plugin forces it directly.
 */
function withCleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Enable cleartext traffic on the <application> tag
    const application = manifest.application?.[0];
    if (application) {
      application['$']['android:usesCleartextTraffic'] = 'true';
    }

    // Add http scheme to <queries> so Android can resolve HTTP URLs
    let queries = manifest.queries;
    if (!queries) {
      queries = manifest.queries = [{}];
    }
    const queriesObj = queries[0];
    if (!queriesObj.intent) {
      queriesObj.intent = [];
    }
    // Check if http intent already exists
    const hasHttp = queriesObj.intent.some(
      (intent) => intent.data?.some((d) => d['$']['android:scheme'] === 'http')
    );
    if (!hasHttp) {
      queriesObj.intent.push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        category: [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
        data: [{ $: { 'android:scheme': 'http' } }],
      });
    }

    return config;
  });
}

module.exports = withCleartextTraffic;
