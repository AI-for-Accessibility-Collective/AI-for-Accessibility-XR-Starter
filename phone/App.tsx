// The app's root. SafeAreaProvider measures the status bar, the notch and the
// navigation bar, on iPhone and on Android (which draws apps edge to edge).
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from './src/App';

export default function Root() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}
