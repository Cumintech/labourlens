import { registerRootComponent } from 'expo';

import * as Sentry from '@sentry/react-native';

import App from './App';

// Crash reporting is a no-op until EXPO_PUBLIC_SENTRY_DSN is set. PII is
// never attached (sendDefaultPii false) -- do not add worker data to events.
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn, sendDefaultPii: false, tracesSampleRate: 0 });
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(sentryDsn ? Sentry.wrap(App) : App);
